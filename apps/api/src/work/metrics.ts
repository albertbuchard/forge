import { getDatabase, runInTransaction } from "../db.js";
import { HttpError } from "../errors.js";
import type { WorkAccess } from "./access.js";
import {
  fingerprint,
  getAuthorizedRoot,
  getOperationReceipt,
  newWorkId,
  nowIso,
  recordWorkActivity,
  rowToWorkRecord,
  storeOperationReceipt,
  type SqlRow
} from "./repository-helpers.js";
import {
  builtInWorkMetricKeys,
  type CreateWorkCheckInInput
} from "./types-operations.js";

const builtInLabels: Record<
  (typeof builtInWorkMetricKeys)[number],
  [string, string]
> = {
  overall_satisfaction: [
    "Overall satisfaction",
    "Your overall experience of this work right now."
  ],
  creativity: ["Creativity", "Room to make, invent, and shape the work."],
  financial_satisfaction: [
    "Financial satisfaction",
    "How satisfied you are with the financial return."
  ],
  financial_adequacy: [
    "Financial adequacy",
    "Whether this work meets the financial needs you have defined."
  ],
  growth_advancement: [
    "Growth and advancement",
    "Visible progress toward greater responsibility or opportunity."
  ],
  learning_skill_development: [
    "Learning and skill development",
    "Useful learning and capability growth."
  ],
  autonomy_decision_authority: [
    "Autonomy and decision authority",
    "Control over decisions, methods, and priorities."
  ],
  meaning_purpose_impact: [
    "Meaning, purpose, and impact",
    "How meaningful and useful the work feels."
  ],
  workload_sustainability: [
    "Workload sustainability",
    "Whether the current workload is maintainable."
  ],
  stress_burnout_risk: [
    "Stress and burnout risk",
    "A personal workload warning signal, not a medical diagnosis."
  ],
  work_life_balance: [
    "Work–life balance",
    "How well work fits with the rest of life."
  ],
  flexibility_time_control: [
    "Flexibility and time control",
    "Control over when and where work happens."
  ],
  job_security_stability: [
    "Security and stability",
    "Perceived continuity and organizational stability."
  ],
  manager_relationship: [
    "Relationship with manager",
    "Trust, communication, and support from the manager."
  ],
  team_relationship: [
    "Relationship with team",
    "Trust, collaboration, and belonging with colleagues."
  ],
  recognition_fairness: [
    "Recognition and fairness",
    "Whether contribution is recognized and decisions feel fair."
  ],
  values_mission_alignment: [
    "Values and mission alignment",
    "Fit with the values and mission that matter to you."
  ],
  professional_environment_quality: [
    "Professional environment",
    "Quality of the technical or professional setting."
  ],
  ownership_ability_to_build: [
    "Ownership and ability to build",
    "Ability to own outcomes and make durable things."
  ],
  energy_before_work: [
    "Energy before work",
    "How energized you feel shortly before working."
  ],
  energy_during_work: [
    "Energy during work",
    "How energized you feel while working."
  ],
  energy_after_work: [
    "Energy after work",
    "How energized or depleted you feel after working."
  ],
  future_excitement: [
    "Excitement about the future",
    "How positive the future of this role feels."
  ]
};

const ordinalScale = {
  minimum: 1,
  maximum: 5,
  anchors: [
    { value: 1, label: "Very low" },
    { value: 2, label: "Low" },
    { value: 3, label: "Mixed" },
    { value: 4, label: "High" },
    { value: 5, label: "Very high" }
  ],
  precision: "ordinal"
};

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseScale(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function assertObservationMatchesDefinition(
  observation: CreateWorkCheckInInput["observations"][number],
  definition: { value_kind: string; scale_json: string }
) {
  if (observation.missingState !== "observed") return;
  if (
    definition.value_kind === "categorical" &&
    observation.categoricalValue === null
  ) {
    throw new HttpError(
      400,
      "work_metric_value_kind_mismatch",
      "This categorical Work metric requires a categorical value."
    );
  }
  if (
    definition.value_kind !== "categorical" &&
    observation.numericValue === null
  ) {
    throw new HttpError(
      400,
      "work_metric_value_kind_mismatch",
      "This numeric or ordinal Work metric requires a numeric value."
    );
  }
  const scale = parseScale(definition.scale_json);
  if (observation.numericValue !== null) {
    if (
      definition.value_kind === "ordinal" &&
      !Number.isInteger(observation.numericValue)
    ) {
      throw new HttpError(
        400,
        "work_metric_ordinal_value_invalid",
        "An ordinal Work metric must use one of its whole-number anchors."
      );
    }
    if (
      typeof scale.minimum === "number" &&
      observation.numericValue < scale.minimum
    ) {
      throw new HttpError(
        400,
        "work_metric_value_out_of_range",
        "The Work metric value is below its defined scale."
      );
    }
    if (
      typeof scale.maximum === "number" &&
      observation.numericValue > scale.maximum
    ) {
      throw new HttpError(
        400,
        "work_metric_value_out_of_range",
        "The Work metric value is above its defined scale."
      );
    }
  }
  if (
    observation.categoricalValue !== null &&
    Array.isArray(scale.options) &&
    !scale.options.includes(observation.categoricalValue)
  ) {
    throw new HttpError(
      400,
      "work_metric_category_invalid",
      "The Work metric category is not part of its defined scale."
    );
  }
}

function builtInMetricId(ownerUserId: string, key: string) {
  return `wmet_builtin_${fingerprint({ ownerUserId, key }).slice(0, 32)}`;
}

function builtInMetricRow(
  ownerUserId: string,
  key: (typeof builtInWorkMetricKeys)[number]
): SqlRow {
  const [displayName, description] = builtInLabels[key];
  return {
    id: builtInMetricId(ownerUserId, key),
    owner_user_id: ownerUserId,
    canonical_key: key,
    version: 1,
    display_name: displayName,
    description,
    value_kind: "ordinal",
    scale_json: json(ordinalScale),
    target_json: "{}",
    warning_json: "{}",
    review_cadence: "monthly",
    enabled: 1,
    is_builtin: 1,
    provenance_json: json({
      sourceKind: "system",
      sourceLabel: "Forge built-in Work metric"
    }),
    revision: 1,
    created_at: null,
    updated_at: null,
    import_receipt_id: null
  };
}

function ensureBuiltInWorkMetric(
  ownerUserId: string,
  key: (typeof builtInWorkMetricKeys)[number]
) {
  const existing = getDatabase()
    .prepare(
      `SELECT * FROM work_metric_definitions
       WHERE owner_user_id = ? AND canonical_key = ? AND is_builtin = 1
       ORDER BY version DESC LIMIT 1`
    )
    .get(ownerUserId, key) as SqlRow | undefined;
  if (existing) return existing;
  const [displayName, description] = builtInLabels[key];
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO work_metric_definitions (
      id, owner_user_id, canonical_key, version, display_name, description, value_kind,
      scale_json, target_json, warning_json, review_cadence, enabled, is_builtin,
      provenance_json, revision, created_at, updated_at, import_receipt_id
    ) VALUES (?, ?, ?, 1, ?, ?, 'ordinal', ?, '{}', '{}', 'monthly', 1, 1, ?, 1, ?, ?, NULL)`
    )
    .run(
      builtInMetricId(ownerUserId, key),
      ownerUserId,
      key,
      displayName,
      description,
      json(ordinalScale),
      json({ sourceKind: "system", sourceLabel: "Forge built-in Work metric" }),
      now,
      now
    );
  return getDatabase()
    .prepare("SELECT * FROM work_metric_definitions WHERE id = ?")
    .get(builtInMetricId(ownerUserId, key)) as SqlRow;
}

export function listWorkMetricDefinitions(access: WorkAccess) {
  if (access.ownerUserIds.length === 0) return [];
  const rows = getDatabase()
    .prepare(
      `SELECT definitions.* FROM work_metric_definitions definitions
       WHERE definitions.owner_user_id IN (${access.ownerUserIds.map(() => "?").join(", ")})
         AND definitions.version = (
           SELECT MAX(candidate.version)
           FROM work_metric_definitions candidate
           WHERE candidate.owner_user_id = definitions.owner_user_id
             AND candidate.canonical_key = definitions.canonical_key
         )
       ORDER BY enabled DESC, is_builtin DESC, canonical_key ASC, version DESC`
    )
    .all(...access.ownerUserIds) as SqlRow[];
  const persistedBuiltIns = new Set(
    rows.flatMap((row) =>
      row.is_builtin === 1
        ? [`${String(row.owner_user_id)}:${String(row.canonical_key)}`]
        : []
    )
  );
  const virtualBuiltIns = access.ownerUserIds.flatMap((ownerUserId) =>
    builtInWorkMetricKeys.flatMap((key) =>
      persistedBuiltIns.has(`${ownerUserId}:${key}`)
        ? []
        : [builtInMetricRow(ownerUserId, key)]
    )
  );
  return [...rows, ...virtualBuiltIns]
    .map((row) => rowToWorkRecord(row, access))
    .sort((left, right) => {
      const owner = String(left.ownerUserId).localeCompare(
        String(right.ownerUserId)
      );
      if (owner !== 0) return owner;
      const builtIn =
        Number(Boolean(right.isBuiltin)) - Number(Boolean(left.isBuiltin));
      if (builtIn !== 0) return builtIn;
      return String(left.canonicalKey).localeCompare(
        String(right.canonicalKey)
      );
    });
}

export function createWorkMetricDefinition(input: {
  access: WorkAccess;
  definition: Record<string, unknown>;
}) {
  return runInTransaction(() => {
    const key = String(input.definition.canonicalKey);
    const isBuiltIn = builtInWorkMetricKeys.includes(
      key as (typeof builtInWorkMetricKeys)[number]
    );
    const current = getDatabase()
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM work_metric_definitions WHERE owner_user_id = ? AND canonical_key = ?"
      )
      .get(input.access.mutationOwnerUserId, key) as { version: number };
    const baseVersion = isBuiltIn ? 1 : 0;
    const currentVisibleVersion = Math.max(current.version, baseVersion);
    const expectedRevision = input.definition.expectedRevision;
    if (
      currentVisibleVersion > 0 &&
      expectedRevision !== currentVisibleVersion
    ) {
      throw new HttpError(
        409,
        "work_metric_definition_version_conflict",
        "This Work metric definition changed before the new version could be saved.",
        {
          expectedVersion: expectedRevision,
          currentVersion: currentVisibleVersion
        }
      );
    }
    const now = nowIso();
    const id = newWorkId("wmet");
    const valueKind = isBuiltIn ? "ordinal" : input.definition.valueKind;
    const scale = isBuiltIn ? ordinalScale : input.definition.scale;
    getDatabase()
      .prepare(
        `INSERT INTO work_metric_definitions (
          id, owner_user_id, canonical_key, version, display_name, description, value_kind,
          scale_json, target_json, warning_json, review_cadence, enabled, is_builtin,
          provenance_json, revision, created_at, updated_at, import_receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`
      )
      .run(
        id,
        input.access.mutationOwnerUserId,
        key,
        currentVisibleVersion + 1,
        String(input.definition.displayName),
        String(input.definition.description ?? ""),
        String(valueKind),
        json(scale),
        json(input.definition.target),
        json(input.definition.warning),
        String(input.definition.reviewCadence ?? "monthly"),
        input.definition.enabled ? 1 : 0,
        isBuiltIn ? 1 : 0,
        json(input.definition.provenance),
        now,
        now
      );
    recordWorkActivity({
      entityType: "work_metric_definition",
      entityId: id,
      eventType: "work_metric_definition_version_created",
      title: `Work metric definition updated: ${String(input.definition.displayName)}`,
      actor: input.access.actor
    });
    return rowToWorkRecord(
      getDatabase()
        .prepare("SELECT * FROM work_metric_definitions WHERE id = ?")
        .get(id) as SqlRow,
      input.access
    );
  });
}

type MetricDefinitionRecord = {
  canonical_key: string;
  version: number;
  owner_user_id: string;
  enabled: number;
  value_kind: string;
  scale_json: string;
};

function resolveObservationDefinition(
  ownerUserId: string,
  metricDefinitionId: string
): MetricDefinitionRecord | undefined {
  const persisted = getDatabase()
    .prepare(
      "SELECT canonical_key, version, owner_user_id, enabled, value_kind, scale_json FROM work_metric_definitions WHERE id = ?"
    )
    .get(metricDefinitionId) as MetricDefinitionRecord | undefined;
  if (persisted) return persisted;
  const builtInKey = builtInWorkMetricKeys.find(
    (key) => builtInMetricId(ownerUserId, key) === metricDefinitionId
  );
  if (!builtInKey) return undefined;
  const row = ensureBuiltInWorkMetric(ownerUserId, builtInKey);
  return {
    canonical_key: String(row.canonical_key),
    version: Number(row.version),
    owner_user_id: String(row.owner_user_id),
    enabled: Number(row.enabled),
    value_kind: String(row.value_kind),
    scale_json: String(row.scale_json)
  };
}

function insertCheckInObservations(input: {
  access: WorkAccess;
  checkIn: CreateWorkCheckInInput;
  checkInId: string;
  observedAt: string;
  createdAt: string;
}) {
  const insert = getDatabase().prepare(
    `INSERT INTO work_metric_observations (
      id, owner_user_id, engagement_id, check_in_id, metric_definition_id,
      metric_key, metric_version, observed_at, timezone, numeric_value,
      categorical_value, missing_state, confidence, note, tags_json, context_json,
      source_kind, confirmation_state, actor_json, provenance_json, created_at, import_receipt_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  );
  return input.checkIn.observations.map((observation) => {
    const definition = resolveObservationDefinition(
      input.access.mutationOwnerUserId,
      observation.metricDefinitionId
    );
    if (
      !definition ||
      definition.owner_user_id !== input.access.mutationOwnerUserId ||
      definition.enabled !== 1
    ) {
      throw new HttpError(
        404,
        "work_metric_definition_not_found",
        "An enabled Work metric definition was not found for this owner."
      );
    }
    assertObservationMatchesDefinition(observation, definition);
    const observationId = newWorkId("wobs");
    insert.run(
      observationId,
      input.access.mutationOwnerUserId,
      input.checkIn.engagementId,
      input.checkInId,
      observation.metricDefinitionId,
      definition.canonical_key,
      definition.version,
      input.observedAt,
      input.checkIn.timezone,
      observation.numericValue,
      observation.categoricalValue,
      observation.missingState,
      observation.confidence,
      observation.note,
      json(observation.tags),
      json({
        ...observation.context,
        userConfirmation: input.checkIn.userConfirmation
      }),
      input.checkIn.sourceKind,
      input.checkIn.confirmationState,
      json(input.access.actor),
      json(input.checkIn.provenance),
      input.createdAt
    );
    return observationId;
  });
}

export function recordWorkCheckIn(
  access: WorkAccess,
  input: CreateWorkCheckInInput
) {
  const engagement = getAuthorizedRoot(
    "work_engagement",
    input.engagementId,
    access
  );
  const requestFingerprint = fingerprint(input);
  const replay = getOperationReceipt({
    ownerUserId: access.mutationOwnerUserId,
    operationKind: "work_check_in",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    access
  });
  if (replay)
    return {
      replayed: true,
      ...((replay.response as Record<string, unknown>) ?? {})
    };
  if (access.actor.kind === "agent" && input.sourceKind === "user_entered") {
    throw new HttpError(
      409,
      "work_metric_user_confirmation_required",
      "An agent cannot label a check-in as directly user-entered. Use an agent suggestion and preserve confirmation evidence."
    );
  }
  if (
    input.sourceKind === "agent_suggested" &&
    input.confirmationState === "confirmed" &&
    input.userConfirmation?.userId !== access.mutationOwnerUserId
  ) {
    throw new HttpError(
      409,
      "work_metric_user_confirmation_required",
      "A confirmed agent suggestion must identify the Work owner who explicitly confirmed it."
    );
  }
  return runInTransaction(() => {
    const now = nowIso();
    const observedAt = input.observedAt ?? now;
    const checkInId = newWorkId("wcheck");
    getDatabase()
      .prepare(
        `INSERT INTO work_check_ins (
          id, owner_user_id, engagement_id, observed_at, timezone, note, tags_json,
          context_json, source_kind, confirmation_state, actor_json, provenance_json,
          created_at, import_receipt_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        checkInId,
        access.mutationOwnerUserId,
        input.engagementId,
        observedAt,
        input.timezone,
        input.note,
        json(input.tags),
        json({ ...input.context, userConfirmation: input.userConfirmation }),
        input.sourceKind,
        input.confirmationState,
        json(access.actor),
        json(input.provenance),
        now
      );
    const observationIds = insertCheckInObservations({
      access,
      checkIn: input,
      checkInId,
      observedAt,
      createdAt: now
    });
    const response = {
      checkIn: rowToWorkRecord(
        getDatabase()
          .prepare("SELECT * FROM work_check_ins WHERE id = ?")
          .get(checkInId) as SqlRow,
        access
      ),
      observations: observationIds.map((id) =>
        rowToWorkRecord(
          getDatabase()
            .prepare("SELECT * FROM work_metric_observations WHERE id = ?")
            .get(id) as SqlRow,
          access
        )
      )
    };
    storeOperationReceipt({
      ownerUserId: access.mutationOwnerUserId,
      operationKind: "work_check_in",
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      response,
      createdRecords: [
        { table: "work_check_ins", id: checkInId },
        ...observationIds.map((id) => ({
          table: "work_metric_observations",
          id
        }))
      ]
    });
    recordWorkActivity({
      entityType: "work_engagement",
      entityId: input.engagementId,
      eventType: "work_check_in_recorded",
      title: `Work check-in recorded for ${String(engagement.title)}`,
      actor: access.actor,
      metadata: { observationCount: observationIds.length }
    });
    return { replayed: false, ...response };
  });
}

function cutoffIso(windowDays: number) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  return cutoff.toISOString();
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function rollingMetricSummary(input: {
  valueKind: string;
  numeric: number[];
  categorical: string[];
}) {
  if (input.valueKind === "categorical") {
    return input.categorical.length === 0
      ? null
      : {
          kind: "latest_category",
          count: input.categorical.length,
          latest: input.categorical.at(-1)
        };
  }
  if (input.numeric.length < 3) return null;
  if (input.valueKind === "ordinal") {
    return {
      kind: "median_anchor",
      count: input.numeric.length,
      median: Number(median(input.numeric).toFixed(1))
    };
  }
  const mean =
    input.numeric.reduce((sum, value) => sum + value, 0) / input.numeric.length;
  return {
    kind: "mean",
    count: input.numeric.length,
    mean: Number(mean.toFixed(2))
  };
}

function meaningfulMetricChange(input: {
  valueKind: string;
  scale: Record<string, unknown>;
  first: number | null;
  last: number | null;
}) {
  if (input.first === null || input.last === null) return null;
  const change = input.last - input.first;
  const configuredStep = input.scale.meaningfulChange;
  const threshold =
    input.valueKind === "ordinal"
      ? 1
      : typeof configuredStep === "number" && configuredStep > 0
        ? configuredStep
        : null;
  if (threshold === null || Math.abs(change) < threshold) return null;
  const unit =
    input.valueKind === "ordinal" ? "anchored scale step" : "scale unit";
  return {
    direction: change > 0 ? "increased" : "decreased",
    magnitude: Number(Math.abs(change).toFixed(2)),
    threshold,
    explanation: `The latest confirmed value is ${Math.abs(change).toFixed(2)} ${unit}${Math.abs(change) === 1 ? "" : "s"} ${change > 0 ? "higher" : "lower"} than the first value in this window.`
  };
}

export function getWorkMetricTrends(input: {
  access: WorkAccess;
  engagementIds: string[];
  metricKeys?: string[];
  windowDays: number;
}) {
  const engagementIds = Array.from(new Set(input.engagementIds));
  for (const id of engagementIds)
    getAuthorizedRoot("work_engagement", id, input.access);
  if (engagementIds.length === 0) {
    return {
      windowDays: input.windowDays,
      observedFrom: cutoffIso(input.windowDays),
      series: [],
      comparisons: []
    };
  }
  const values: string[] = [...engagementIds, cutoffIso(input.windowDays)];
  const clauses = [
    `engagement_id IN (${engagementIds.map(() => "?").join(", ")})`,
    "observed_at >= ?",
    "confirmation_state = 'confirmed'"
  ];
  if (input.metricKeys && input.metricKeys.length > 0) {
    clauses.push(
      `metric_key IN (${input.metricKeys.map(() => "?").join(", ")})`
    );
    values.push(...input.metricKeys);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM work_metric_observations
       WHERE ${clauses.join(" AND ")}
       ORDER BY engagement_id, metric_key, observed_at ASC, id ASC`
    )
    .all(...values) as SqlRow[];
  const groups = new Map<string, SqlRow[]>();
  for (const row of rows) {
    const key = `${String(row.engagement_id)}:${String(row.metric_key)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const series = [...groups.entries()].map(([key, points]) => {
    const [engagementId, metricKey] = key.split(":", 2) as [string, string];
    const numeric = points.flatMap((point) =>
      typeof point.numeric_value === "number" &&
      point.missing_state === "observed"
        ? [point.numeric_value]
        : []
    );
    const categorical = points.flatMap((point) =>
      typeof point.categorical_value === "string" &&
      point.missing_state === "observed"
        ? [point.categorical_value]
        : []
    );
    const first = numeric[0] ?? null;
    const last = numeric.at(-1) ?? null;
    const latestDefinitionId = String(
      points.at(-1)?.metric_definition_id ?? ""
    );
    const definition = getDatabase()
      .prepare("SELECT * FROM work_metric_definitions WHERE id = ?")
      .get(latestDefinitionId) as SqlRow | undefined;
    const valueKind = String(definition?.value_kind ?? "unknown");
    const scale = definition ? parseScale(String(definition.scale_json)) : {};
    return {
      engagementId,
      metricKey,
      metricDefinitionId: latestDefinitionId,
      metricDefinitionVersion: definition?.version ?? null,
      displayName: definition?.display_name ?? metricKey,
      valueKind,
      scale,
      target: definition ? parseScale(String(definition.target_json)) : {},
      warning: definition ? parseScale(String(definition.warning_json)) : {},
      points: points.map((row) => rowToWorkRecord(row, input.access)),
      rollingSummary: rollingMetricSummary({ valueKind, numeric, categorical }),
      meaningfulChange: meaningfulMetricChange({
        valueKind,
        scale,
        first,
        last
      })
    };
  });
  const comparisons = [...new Set(series.map((entry) => entry.metricKey))]
    .map((metricKey) => {
      const comparableSeries = series.filter(
        (entry) => entry.metricKey === metricKey
      );
      if (comparableSeries.length < 2) return null;
      const scaleComparable = comparableSeries.every(
        (entry) =>
          JSON.stringify(entry.scale) ===
          JSON.stringify(comparableSeries[0].scale)
      );
      return {
        metricKey,
        displayName: comparableSeries[0].displayName,
        valueKind: comparableSeries[0].valueKind,
        scaleComparable,
        scale: scaleComparable ? comparableSeries[0].scale : null,
        engagements: comparableSeries.map((entry) => {
          const latest = entry.points.at(-1) as
            | Record<string, unknown>
            | undefined;
          return {
            engagementId: entry.engagementId,
            numericValue: latest?.numericValue ?? null,
            categoricalValue: latest?.categoricalValue ?? null,
            missingState: latest?.missingState ?? "unknown",
            observedAt: latest?.observedAt ?? null,
            observationCount: entry.points.length,
            metricDefinitionId: entry.metricDefinitionId,
            metricDefinitionVersion: entry.metricDefinitionVersion,
            scale: entry.scale
          };
        })
      };
    })
    .filter(
      (comparison): comparison is NonNullable<typeof comparison> =>
        comparison !== null
    );
  return {
    windowDays: input.windowDays,
    observedFrom: cutoffIso(input.windowDays),
    series,
    comparisons
  };
}
