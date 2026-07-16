import { z } from "zod";

export const PERSON_CONTACT_PREFERENCES_MAX_BYTES = 65_536;
export const PERSON_METADATA_MAX_BYTES = 131_072;
export const PERSON_FACT_VALUE_MAX_BYTES = 131_072;
export const PERSON_PROVENANCE_MAX_BYTES = 65_536;
export const PERSON_JSON_MAX_DEPTH = 32;
export const PERSON_JSON_MAX_NODES = 20_000;
export const PERSON_JSON_MAX_KEYS = 10_000;

export type PersonJsonValue =
  | string
  | number
  | boolean
  | null
  | PersonJsonValue[]
  | { [key: string]: PersonJsonValue };

const UNSAFE_PERSON_JSON_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype"
]);

function inspectPersonJsonValue(value: unknown): string | null {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 }
  ];
  let nodeCount = 0;
  let keyCount = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > PERSON_JSON_MAX_NODES) {
      return `JSON value must not exceed ${PERSON_JSON_MAX_NODES} nodes.`;
    }
    if (current.depth > PERSON_JSON_MAX_DEPTH) {
      return `JSON value must not exceed a depth of ${PERSON_JSON_MAX_DEPTH}.`;
    }

    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        return "JSON numbers must be finite.";
      }
      continue;
    }
    if (typeof current.value !== "object") {
      return "Value must contain only JSON-compatible data.";
    }

    if (Array.isArray(current.value)) {
      if (Object.getPrototypeOf(current.value) !== Array.prototype) {
        return "JSON arrays must use the standard Array prototype.";
      }
      if (current.value.length > PERSON_JSON_MAX_NODES - nodeCount) {
        return `JSON value must not exceed ${PERSON_JSON_MAX_NODES} nodes.`;
      }
      const ownKeys = Reflect.ownKeys(current.value);
      for (const key of ownKeys) {
        if (typeof key !== "string") {
          return "JSON values must not contain symbol keys.";
        }
        if (key === "length") {
          continue;
        }
        const index = Number(key);
        if (
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= current.value.length ||
          String(index) !== key
        ) {
          return "JSON arrays must not contain named properties.";
        }
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current.value,
          String(index)
        );
        if (!descriptor || !("value" in descriptor)) {
          return "JSON arrays must be dense and must not contain accessors.";
        }
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      return "JSON objects must use a plain or null prototype.";
    }
    if (Object.getOwnPropertySymbols(current.value).length > 0) {
      return "JSON values must not contain symbol keys.";
    }
    const keys = Object.getOwnPropertyNames(current.value);
    keyCount += keys.length;
    if (keyCount > PERSON_JSON_MAX_KEYS) {
      return `JSON value must not exceed ${PERSON_JSON_MAX_KEYS} object keys.`;
    }
    for (const key of keys) {
      if (UNSAFE_PERSON_JSON_KEYS.has(key)) {
        return `JSON object key "${key}" is not allowed.`;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return "JSON objects must contain enumerable data properties only.";
      }
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }

  return null;
}

export const personJsonValueSchema = z
  .unknown()
  .superRefine((value, context) => {
    const issue = inspectPersonJsonValue(value);
    if (issue) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: issue });
    }
  }) as z.ZodType<PersonJsonValue>;

function jsonByteLength(value: PersonJsonValue): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? null
      : Buffer.byteLength(serialized, "utf8");
  } catch {
    return null;
  }
}

function boundedJsonObject(maximumBytes: number) {
  return personJsonValueSchema
    .refine(
      (value): value is Record<string, PersonJsonValue> =>
        value !== null && !Array.isArray(value) && typeof value === "object",
      "JSON value must be an object."
    )
    .superRefine((value, context) => {
      const byteLength = jsonByteLength(value);
      if (byteLength !== null && byteLength > maximumBytes) {
        context.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "array",
          maximum: maximumBytes,
          inclusive: true,
          message: `JSON value must not exceed ${maximumBytes} bytes.`
        });
      }
    });
}

function boundedJsonValue(maximumBytes: number) {
  return personJsonValueSchema.superRefine((value, context) => {
    const byteLength = jsonByteLength(value);
    if (byteLength !== null && byteLength > maximumBytes) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: maximumBytes,
        inclusive: true,
        message: `JSON value must not exceed ${maximumBytes} bytes.`
      });
    }
  });
}

export function normalizePersonWhitespace(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function normalizePersonSearchText(value: string): string {
  return normalizePersonWhitespace(value)
    .normalize("NFKC")
    .toLocaleLowerCase("und");
}

const identifierSchema = z.string().trim().min(1).max(240);
const displayNameSchema = z
  .string()
  .transform(normalizePersonWhitespace)
  .pipe(z.string().min(1).max(240));
const optionalNameSchema = z
  .string()
  .transform(normalizePersonWhitespace)
  .pipe(z.string().max(160));
const boundedLabelSchema = z
  .string()
  .transform(normalizePersonWhitespace)
  .pipe(z.string().max(240));
const boundedProseSchema = (maximum: number) => z.string().max(maximum);

function hasAsciiControlCharacter(
  value: string,
  includeSpace = false
): boolean {
  const maximumLowCodePoint = includeSpace ? 32 : 31;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= maximumLowCodePoint || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function isValidEmailContact(value: string): boolean {
  if (value.length > 254 || hasAsciiControlCharacter(value, true)) {
    return false;
  }
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator !== value.indexOf("@")) {
    return false;
  }
  const localPart = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(localPart)
  ) {
    return false;
  }
  try {
    const url = new URL(`http://${domain}`);
    const hostname = url.hostname;
    if (
      !hostname ||
      hostname.length > 253 ||
      hostname !== hostname.trim() ||
      url.port.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return false;
    }
    const labels = hostname.replace(/\.$/u, "").split(".");
    return labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
    );
  } catch {
    return false;
  }
}

function parsePhoneContact(value: string): {
  mainDigits: string;
  extension: string;
} | null {
  if (hasAsciiControlCharacter(value)) {
    return null;
  }
  const match =
    /^(\+?[0-9().\s/*#-]+?)(?:\s*(?:x|ext\.?|extension)\s*([0-9]{1,10}))?$/iu.exec(
      value
    );
  if (!match) {
    return null;
  }
  const mainDigits = match[1]!.replace(/\D/gu, "");
  if (mainDigits.length < 3 || mainDigits.length > 15) {
    return null;
  }
  return { mainDigits, extension: match[2] ?? "" };
}

function isValidHttpWebsite(value: string): boolean {
  if (hasAsciiControlCharacter(value, true)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isValidOptionalIsoDate(value: string | null): boolean {
  if (value === null) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }
  return (
    Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  );
}

function isValidTimezone(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const personBirthdayPrecisionSchema = z.enum([
  "unknown",
  "year",
  "month_day",
  "year_month",
  "full"
]);

type BirthdayFields = {
  birthdayYear: number | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  birthdayPrecision: z.infer<typeof personBirthdayPrecisionSchema>;
};

function validateBirthday(
  fields: BirthdayFields,
  context: z.RefinementCtx
): void {
  const { birthdayYear, birthdayMonth, birthdayDay, birthdayPrecision } =
    fields;
  const validShape =
    (birthdayPrecision === "unknown" &&
      birthdayYear === null &&
      birthdayMonth === null &&
      birthdayDay === null) ||
    (birthdayPrecision === "year" &&
      birthdayYear !== null &&
      birthdayMonth === null &&
      birthdayDay === null) ||
    (birthdayPrecision === "month_day" &&
      birthdayYear === null &&
      birthdayMonth !== null &&
      birthdayDay !== null) ||
    (birthdayPrecision === "year_month" &&
      birthdayYear !== null &&
      birthdayMonth !== null &&
      birthdayDay === null) ||
    (birthdayPrecision === "full" &&
      birthdayYear !== null &&
      birthdayMonth !== null &&
      birthdayDay !== null);

  if (!validShape) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["birthdayPrecision"],
      message: "Birthday values must match the selected precision."
    });
    return;
  }

  if (birthdayMonth !== null && birthdayDay !== null) {
    const validationYear = birthdayYear ?? 2000;
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(validationYear, birthdayMonth - 1, birthdayDay);
    if (
      date.getUTCFullYear() !== validationYear ||
      date.getUTCMonth() !== birthdayMonth - 1 ||
      date.getUTCDate() !== birthdayDay
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["birthdayDay"],
        message: "Birthday month and day must form a real calendar date."
      });
    }
  }
}

export const personAliasKindSchema = z.enum([
  "name",
  "nickname",
  "former_name",
  "handle"
]);

export const personContactKindSchema = z.enum([
  "email",
  "phone",
  "messaging",
  "social",
  "address",
  "website",
  "custom"
]);

export const personContactVisibilitySchema = z.enum([
  "private",
  "selected",
  "shared"
]);

export const personFactSensitivitySchema = z.enum([
  "basic",
  "private",
  "sensitive",
  "restricted"
]);

export const personFactSourceKindSchema = z.enum([
  "manual",
  "imported",
  "observed",
  "inferred",
  "entity"
]);

export const personActorBindingKindSchema = z.enum(["self", "local_actor"]);

export const personAliasInputSchema = z
  .object({
    alias: displayNameSchema,
    kind: personAliasKindSchema.default("name")
  })
  .strict();

export const personAliasSchema = z
  .object({
    id: identifierSchema,
    personId: identifierSchema,
    alias: displayNameSchema,
    normalizedAlias: z.string().min(1).max(240),
    kind: personAliasKindSchema,
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict();

export const personContactMethodInputSchema = z
  .object({
    kind: personContactKindSchema,
    label: boundedLabelSchema.default(""),
    value: z.string().trim().min(1).max(4000),
    isPrimary: z.boolean().default(false),
    visibility: personContactVisibilitySchema.default("private"),
    provenance: boundedJsonObject(PERSON_PROVENANCE_MAX_BYTES).default({})
  })
  .strict()
  .superRefine((contact, context) => {
    if (contact.kind === "email" && !isValidEmailContact(contact.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Email contact values must be valid email addresses."
      });
    }
    if (contact.kind === "phone" && !parsePhoneContact(contact.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Phone contact values must be valid telephone numbers."
      });
    }
    if (contact.kind === "website" && !isValidHttpWebsite(contact.value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Website contact values must be valid HTTP or HTTPS URLs."
      });
    }
  });

export const personContactMethodSchema = z
  .object({
    id: identifierSchema,
    personId: identifierSchema,
    kind: personContactKindSchema,
    label: z.string().max(240),
    value: z.string().min(1).max(4000),
    normalizedValue: z.string().min(1).max(4000),
    isPrimary: z.boolean(),
    visibility: personContactVisibilitySchema,
    provenance: boundedJsonObject(PERSON_PROVENANCE_MAX_BYTES),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable()
  })
  .strict();

export const personFactInputSchema = z
  .object({
    factType: z.string().trim().min(1).max(120),
    label: z.string().trim().max(500).default(""),
    value: boundedJsonValue(PERSON_FACT_VALUE_MAX_BYTES),
    sensitivity: personFactSensitivitySchema.default("private"),
    sourceKind: personFactSourceKindSchema.default("manual"),
    sourceEntityType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .default(null),
    sourceEntityId: identifierSchema.nullable().default(null),
    observedAt: z.string().datetime({ offset: true }).nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
    reviewedAt: z.string().datetime({ offset: true }).nullable().default(null)
  })
  .strict()
  .superRefine((fact, context) => {
    if ((fact.sourceEntityType === null) !== (fact.sourceEntityId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceEntityId"],
        message: "Fact provenance requires both source entity type and id."
      });
    }
    if (fact.sourceKind === "entity" && fact.sourceEntityId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceEntityId"],
        message: "Entity-sourced facts require a source entity."
      });
    }
  });

export const personFactSchema = z
  .object({
    id: identifierSchema,
    personId: identifierSchema,
    factType: z.string().min(1).max(120),
    label: z.string().max(500),
    value: boundedJsonValue(PERSON_FACT_VALUE_MAX_BYTES),
    sensitivity: personFactSensitivitySchema,
    sourceKind: personFactSourceKindSchema,
    sourceEntityType: z.string().nullable(),
    sourceEntityId: z.string().nullable(),
    observedAt: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    reviewedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable()
  })
  .strict();

export const personActorBindingSchema = z
  .object({
    id: identifierSchema,
    personId: identifierSchema,
    ownerUserId: identifierSchema,
    actorUserId: identifierSchema,
    bindingKind: personActorBindingKindSchema,
    verifiedAt: z.string().nullable(),
    createdAt: z.string()
  })
  .strict();

const personInputShape = {
  displayName: displayNameSchema,
  givenName: optionalNameSchema.default(""),
  middleName: optionalNameSchema.default(""),
  familyName: optionalNameSchema.default(""),
  preferredName: optionalNameSchema.default(""),
  pronouns: z.string().trim().max(120).default(""),
  relationshipCategory: z.string().trim().max(120).default(""),
  relationshipLabel: boundedLabelSchema.default(""),
  closeness: z.number().int().min(0).max(5).nullable().default(null),
  importance: z.number().int().min(0).max(5).nullable().default(null),
  shortDescription: boundedProseSchema(2000).default(""),
  description: boundedProseSchema(50000).default(""),
  privateNotes: boundedProseSchema(100000).default(""),
  howWeMet: boundedProseSchema(10000).default(""),
  metAt: z
    .string()
    .max(64)
    .nullable()
    .default(null)
    .refine(
      isValidOptionalIsoDate,
      "metAt must be an ISO date or offset date-time."
    ),
  birthdayYear: z.number().int().min(1).max(9999).nullable().default(null),
  birthdayMonth: z.number().int().min(1).max(12).nullable().default(null),
  birthdayDay: z.number().int().min(1).max(31).nullable().default(null),
  birthdayPrecision: personBirthdayPrecisionSchema.default("unknown"),
  timezone: z
    .string()
    .trim()
    .max(128)
    .default("")
    .refine(isValidTimezone, "timezone must be a valid IANA timezone."),
  homePlaceLabel: z.string().trim().max(500).default(""),
  contactPreferences: boundedJsonObject(
    PERSON_CONTACT_PREFERENCES_MAX_BYTES
  ).default({}),
  metadata: boundedJsonObject(PERSON_METADATA_MAX_BYTES).default({})
};

export const personEntityLinkInputSchema = z
  .object({
    entityType: z.string().trim().min(1).max(120),
    entityId: identifierSchema,
    anchorKey: z.string().trim().max(256).nullable().optional(),
    relationship: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .default("related_to")
  })
  .strict();

export const createPersonSchema = z
  .object({
    userId: identifierSchema,
    ...personInputShape,
    aliases: z.array(personAliasInputSchema).max(256).default([]),
    contacts: z.array(personContactMethodInputSchema).max(256).default([]),
    facts: z.array(personFactInputSchema).max(1000).default([]),
    links: z.array(personEntityLinkInputSchema).max(500).default([])
  })
  .strict()
  .superRefine(validateBirthday);

export const updatePersonSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    givenName: optionalNameSchema.optional(),
    middleName: optionalNameSchema.optional(),
    familyName: optionalNameSchema.optional(),
    preferredName: optionalNameSchema.optional(),
    pronouns: z.string().trim().max(120).optional(),
    relationshipCategory: z.string().trim().max(120).optional(),
    relationshipLabel: boundedLabelSchema.optional(),
    closeness: z.number().int().min(0).max(5).nullable().optional(),
    importance: z.number().int().min(0).max(5).nullable().optional(),
    shortDescription: boundedProseSchema(2000).optional(),
    description: boundedProseSchema(50000).optional(),
    privateNotes: boundedProseSchema(100000).optional(),
    howWeMet: boundedProseSchema(10000).optional(),
    metAt: z
      .string()
      .max(64)
      .nullable()
      .refine(
        isValidOptionalIsoDate,
        "metAt must be an ISO date or offset date-time."
      )
      .optional(),
    birthdayYear: z.number().int().min(1).max(9999).nullable().optional(),
    birthdayMonth: z.number().int().min(1).max(12).nullable().optional(),
    birthdayDay: z.number().int().min(1).max(31).nullable().optional(),
    birthdayPrecision: personBirthdayPrecisionSchema.optional(),
    timezone: z
      .string()
      .trim()
      .max(128)
      .refine(isValidTimezone, "timezone must be a valid IANA timezone.")
      .optional(),
    homePlaceLabel: z.string().trim().max(500).optional(),
    contactPreferences: boundedJsonObject(
      PERSON_CONTACT_PREFERENCES_MAX_BYTES
    ).optional(),
    metadata: boundedJsonObject(PERSON_METADATA_MAX_BYTES).optional(),
    links: z.array(personEntityLinkInputSchema).max(500).optional(),
    expectedUpdatedAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

export const personSchema = z
  .object({
    id: identifierSchema,
    userId: identifierSchema,
    normalizedDisplayName: z.string().min(1).max(240),
    ...personInputShape,
    aliases: z.array(personAliasSchema),
    contacts: z.array(personContactMethodSchema),
    facts: z.array(personFactSchema),
    actorBindings: z.array(personActorBindingSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable()
  })
  .strict()
  .superRefine(validateBirthday);

export const peopleListQuerySchema = z
  .object({
    userId: identifierSchema,
    q: z.string().trim().max(240).default(""),
    relationshipCategory: z.string().trim().max(120).optional(),
    includeDeleted: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
    sort: z.enum(["name", "updated", "importance"]).default("name")
  })
  .strict();

export const personEntityRefSchema = z
  .object({
    entityType: z.string().trim().min(1).max(120),
    entityId: identifierSchema
  })
  .strict();

export const personLinkInputSchema = z
  .object({
    targetEntityType: z.string().trim().min(1).max(120),
    targetEntityId: identifierSchema,
    anchorKey: z.string().trim().max(256).default(""),
    relationship: z.string().trim().min(1).max(120).default("related_to")
  })
  .strict();

export const personLinkSchema = z
  .object({
    sourceEntityType: z.string(),
    sourceEntityId: z.string(),
    targetEntityType: z.string(),
    targetEntityId: z.string(),
    anchorKey: z.string().nullable(),
    relationship: z.string(),
    createdByActor: z.string().nullable(),
    createdAt: z.string()
  })
  .strict();

export const wikiPeopleCandidateScanSchema = z
  .object({
    userId: identifierSchema,
    spaceId: identifierSchema.optional(),
    rootSlug: z.string().trim().min(1).max(240).default("people"),
    includeAssociated: z.boolean().default(true),
    limit: z.number().int().min(1).max(500).default(200)
  })
  .strict();

export const wikiPersonCandidateSchema = z
  .object({
    noteId: identifierSchema,
    rootNoteId: identifierSchema,
    spaceId: identifierSchema,
    title: z.string(),
    slug: z.string(),
    parentSlug: z.string().nullable(),
    aliases: z.array(z.string()),
    summary: z.string(),
    updatedAt: z.string(),
    matchingPersonIds: z.array(identifierSchema),
    associatedPersonIds: z.array(identifierSchema),
    duplicateCandidateNoteIds: z.array(identifierSchema),
    status: z.enum(["unmatched", "single_match", "ambiguous", "associated"])
  })
  .strict();

export const wikiPeopleCandidateScanResultSchema = z
  .object({
    candidates: z.array(wikiPersonCandidateSchema),
    rootCount: z.number().int().nonnegative(),
    scannedCount: z.number().int().nonnegative(),
    truncated: z.boolean()
  })
  .strict();

const wikiCreatePersonSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    preferredName: optionalNameSchema.optional(),
    relationshipCategory: z.string().trim().max(120).optional(),
    relationshipLabel: boundedLabelSchema.optional(),
    shortDescription: boundedProseSchema(2000).optional(),
    aliases: z.array(personAliasInputSchema).max(256).optional()
  })
  .strict();

const wikiAssociationVersionSchema = z.string().datetime({ offset: true });

export const wikiPersonAssociationDecisionSchema = z.discriminatedUnion(
  "action",
  [
    z
      .object({
        action: z.literal("associate"),
        candidateNoteId: identifierSchema,
        personId: identifierSchema,
        expectedWikiVersion: wikiAssociationVersionSchema.optional(),
        expectedPersonVersion: wikiAssociationVersionSchema.optional()
      })
      .strict(),
    z
      .object({
        action: z.literal("create"),
        candidateNoteId: identifierSchema,
        person: wikiCreatePersonSchema.default({}),
        expectedWikiVersion: wikiAssociationVersionSchema.optional()
      })
      .strict(),
    z
      .object({
        action: z.literal("skip"),
        candidateNoteId: identifierSchema,
        expectedWikiVersion: wikiAssociationVersionSchema.optional()
      })
      .strict()
  ]
);

export const wikiPersonAssociationBatchSchema = z
  .object({
    userId: identifierSchema,
    rootSlug: z.string().trim().min(1).max(240).default("people"),
    decisions: z.array(wikiPersonAssociationDecisionSchema).min(1).max(500),
    actor: z.string().trim().max(240).nullable().default(null),
    atomic: z.literal(true).default(true)
  })
  .strict()
  .superRefine((batch, context) => {
    const seen = new Set<string>();
    for (const [index, decision] of batch.decisions.entries()) {
      if (seen.has(decision.candidateNoteId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["decisions", index, "candidateNoteId"],
          message: "A Wiki candidate can appear only once in an atomic batch."
        });
      }
      seen.add(decision.candidateNoteId);
    }
  });

export const wikiPersonAssociationResultSchema = z
  .object({
    candidateNoteId: identifierSchema,
    action: z.enum(["associate", "create", "skip"]),
    status: z.enum(["associated", "already_associated", "created", "skipped"]),
    personId: identifierSchema.nullable(),
    linkCreated: z.boolean()
  })
  .strict();

const previewDecisionArraySchema = z
  .array(wikiPersonAssociationDecisionSchema)
  .min(1)
  .max(500)
  .superRefine((decisions, context) => {
    const seen = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
      if (seen.has(decision.candidateNoteId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "candidateNoteId"],
          message: "A Wiki candidate can appear only once in a preview."
        });
      }
      seen.add(decision.candidateNoteId);
      if (decision.expectedWikiVersion === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "expectedWikiVersion"],
          message:
            "Wiki previews require the candidate version returned by scan."
        });
      }
    }
  });

export const wikiPersonAssociationPreviewRequestSchema = z
  .object({
    userId: identifierSchema,
    rootSlug: z.string().trim().min(1).max(240).default("people"),
    decisions: previewDecisionArraySchema,
    actor: z.string().trim().max(240).nullable().default(null)
  })
  .strict();

export const wikiPersonAssociationPreviewSchema = z
  .object({
    previewId: identifierSchema,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
    decisions: previewDecisionArraySchema,
    createdAt: wikiAssociationVersionSchema,
    expiresAt: wikiAssociationVersionSchema
  })
  .strict();

export const wikiPersonAssociationApplySchema = z
  .object({
    userId: identifierSchema,
    previewId: identifierSchema,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
    idempotencyKey: z
      .string()
      .trim()
      .min(16)
      .max(240)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    decisions: previewDecisionArraySchema,
    actor: z.string().trim().max(240).nullable().default(null)
  })
  .strict();

export const wikiPersonAssociationApplyResultSchema = z
  .object({
    previewId: identifierSchema,
    replayed: z.boolean(),
    results: z.array(wikiPersonAssociationResultSchema).max(500)
  })
  .strict();

export type PersonAliasInput = z.input<typeof personAliasInputSchema>;
export type PersonAlias = z.infer<typeof personAliasSchema>;
export type PersonContactMethodInput = z.input<
  typeof personContactMethodInputSchema
>;
export type PersonContactMethod = z.infer<typeof personContactMethodSchema>;
export type PersonFactInput = z.input<typeof personFactInputSchema>;
export type PersonFact = z.infer<typeof personFactSchema>;
export type PersonActorBinding = z.infer<typeof personActorBindingSchema>;
export type CreatePersonInput = z.input<typeof createPersonSchema>;
export type ParsedCreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.input<typeof updatePersonSchema>;
export type Person = z.infer<typeof personSchema>;
export type PeopleListQuery = z.input<typeof peopleListQuerySchema>;
export type PersonEntityRef = z.infer<typeof personEntityRefSchema>;
export type PersonLinkInput = z.input<typeof personLinkInputSchema>;
export type PersonLink = z.infer<typeof personLinkSchema>;
export type WikiPeopleCandidateScan = z.input<
  typeof wikiPeopleCandidateScanSchema
>;
export type WikiPersonCandidate = z.infer<typeof wikiPersonCandidateSchema>;
export type WikiPeopleCandidateScanResult = z.infer<
  typeof wikiPeopleCandidateScanResultSchema
>;
export type WikiPersonAssociationDecision = z.input<
  typeof wikiPersonAssociationDecisionSchema
>;
export type WikiPersonAssociationBatch = z.input<
  typeof wikiPersonAssociationBatchSchema
>;
export type WikiPersonAssociationResult = z.infer<
  typeof wikiPersonAssociationResultSchema
>;
export type WikiPersonAssociationPreviewRequest = z.input<
  typeof wikiPersonAssociationPreviewRequestSchema
>;
export type WikiPersonAssociationPreview = z.infer<
  typeof wikiPersonAssociationPreviewSchema
>;
export type WikiPersonAssociationApply = z.input<
  typeof wikiPersonAssociationApplySchema
>;
export type WikiPersonAssociationApplyResult = z.infer<
  typeof wikiPersonAssociationApplyResultSchema
>;

export type PersonEntityAuthorizationOperation = "read" | "link" | "unlink";

export type PersonEntityAuthorizationRequest = {
  userId: string;
  entityType: string;
  entityId: string;
  operation: PersonEntityAuthorizationOperation;
};

export type PersonEntityAuthorizationCallback = (
  request: PersonEntityAuthorizationRequest
) => boolean;

export type PersonActorBindingAuthorizationCallback = (request: {
  ownerUserId: string;
  personId: string;
  actorUserId: string;
  bindingKind: z.infer<typeof personActorBindingKindSchema>;
}) => boolean;
