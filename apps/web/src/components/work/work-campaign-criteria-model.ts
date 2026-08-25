import type { WorkRecord } from "@/lib/work-api";
import { lines } from "@/components/work/work-dialog-helpers";

export type CriteriaDraft = {
  desiredTitles: string;
  excludedTitles: string;
  desiredFunctions: string;
  excludedFunctions: string;
  roleFamilies: string;
  seniorityLevels: string;
  sectors: string;
  technologyAreas: string;
  responsibilityBalance: string;
  careerPath: "any" | "individual_contributor" | "management";
  minimumHandsOnPercent: string;
  maximumTeamSize: string;
  maximumOnCall: string;
  maximumTravelPercent: string;
  customerExposure: "any" | "preferred" | "required" | "excluded";
  publicationFreedom: "any" | "preferred" | "required";
  openSourceFreedom: "any" | "preferred" | "required";
  minimumResearchPercent: string;
  employmentTypes: string;
  locations: string;
  excludedLocations: string;
  workModel: "any" | "remote" | "hybrid" | "on_site";
  maximumOfficeDays: string;
  maximumCommuteMinutes: string;
  relocation:
    | "unknown"
    | "unwilling"
    | "possible"
    | "willing"
    | "required_support";
  sponsorship:
    | "unknown"
    | "not_needed"
    | "needed"
    | "acceptable"
    | "unacceptable";
  scheduleConstraints: string;
  workingDays: string;
  timezoneOverlap: string;
  sideJobCompatibility: "unknown" | "not_needed" | "preferred" | "required";
  desiredDuration: string;
  noticeValue: string;
  noticeUnit: "days" | "weeks" | "months";
  earliestStartDate: string;
  preferredStartDate: string;
  availabilityConditions: string;
  minimumCompensation: string;
  targetCompensation: string;
  stretchCompensation: string;
  currency: string;
  compensationBasis: "gross" | "net" | "unknown";
  compensationNegotiability: "unknown" | "fixed" | "negotiable";
  desiredBenefits: string;
  minimumHours: string;
  maximumHours: string;
  organizationPreferences: string;
  organizationExclusions: string;
  cultureMissionEthics: string;
  growthPriorities: string;
  futureRolePaths: string;
  growthTimeHorizon: string;
  includeKeywords: string;
  excludeKeywords: string;
  requiredSources: string;
  minimumConfidencePercent: string;
  evidenceFreshnessDays: string;
  disqualificationRules: string;
  dealBreakers: string;
  tradeoffs: string;
  minimumExcitement: string;
  uncertaintyTolerance: "low" | "medium" | "high";
};

export const emptyCriteria: CriteriaDraft = {
  desiredTitles: "",
  excludedTitles: "",
  desiredFunctions: "",
  excludedFunctions: "",
  roleFamilies: "",
  seniorityLevels: "",
  sectors: "",
  technologyAreas: "",
  responsibilityBalance: "",
  careerPath: "any",
  minimumHandsOnPercent: "",
  maximumTeamSize: "",
  maximumOnCall: "",
  maximumTravelPercent: "",
  customerExposure: "any",
  publicationFreedom: "any",
  openSourceFreedom: "any",
  minimumResearchPercent: "",
  employmentTypes: "",
  locations: "",
  excludedLocations: "",
  workModel: "any",
  maximumOfficeDays: "",
  maximumCommuteMinutes: "",
  relocation: "unknown",
  sponsorship: "unknown",
  scheduleConstraints: "",
  workingDays: "",
  timezoneOverlap: "",
  sideJobCompatibility: "unknown",
  desiredDuration: "",
  noticeValue: "",
  noticeUnit: "months",
  earliestStartDate: "",
  preferredStartDate: "",
  availabilityConditions: "",
  minimumCompensation: "",
  targetCompensation: "",
  stretchCompensation: "",
  currency: "CHF",
  compensationBasis: "gross",
  compensationNegotiability: "unknown",
  desiredBenefits: "",
  minimumHours: "",
  maximumHours: "",
  organizationPreferences: "",
  organizationExclusions: "",
  cultureMissionEthics: "",
  growthPriorities: "",
  futureRolePaths: "",
  growthTimeHorizon: "",
  includeKeywords: "",
  excludeKeywords: "",
  requiredSources: "",
  minimumConfidencePercent: "",
  evidenceFreshnessDays: "",
  disqualificationRules: "",
  dealBreakers: "",
  tradeoffs: "",
  minimumExcitement: "",
  uncertaintyTolerance: "medium"
};

export function criteriaDocument(value: CriteriaDraft, previous?: WorkRecord) {
  const criteria: Array<Record<string, unknown>> = [];
  const add = (criterion: Record<string, unknown>) =>
    criteria.push({
      weight: 50,
      flexibility: "medium",
      rationale: "",
      evidenceRequirement: "",
      evidenceFreshnessDays: value.evidenceFreshnessDays
        ? Number(value.evidenceFreshnessDays)
        : null,
      disqualificationRule: "",
      unknown: false,
      ...criterion
    });
  if (lines(value.desiredTitles).length)
    add({
      key: "desired_titles",
      section: "role",
      field: "title",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.desiredTitles),
      weight: 85
    });
  if (lines(value.excludedTitles).length)
    add({
      key: "excluded_titles",
      section: "role",
      field: "title",
      kind: "set",
      importance: "hard",
      operator: "not_in",
      value: lines(value.excludedTitles),
      weight: 100,
      flexibility: "none",
      disqualificationRule:
        "Disqualify when the role title clearly belongs to an excluded family."
    });
  if (lines(value.desiredFunctions).length)
    add({
      key: "desired_functions",
      section: "role",
      field: "function",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.desiredFunctions),
      weight: 80
    });
  if (lines(value.excludedFunctions).length)
    add({
      key: "excluded_functions",
      section: "role",
      field: "function",
      kind: "set",
      importance: "hard",
      operator: "not_in",
      value: lines(value.excludedFunctions),
      weight: 100,
      flexibility: "none"
    });
  if (lines(value.roleFamilies).length)
    add({
      key: "role_families",
      section: "role",
      field: "role_family",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.roleFamilies),
      weight: 80
    });
  if (lines(value.seniorityLevels).length)
    add({
      key: "seniority_levels",
      section: "role",
      field: "seniority",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.seniorityLevels),
      weight: 75
    });
  if (lines(value.sectors).length)
    add({
      key: "sectors",
      section: "role",
      field: "sector",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.sectors),
      weight: 65
    });
  if (lines(value.technologyAreas).length)
    add({
      key: "technology_areas",
      section: "role",
      field: "technology",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.technologyAreas),
      weight: 65
    });
  if (lines(value.responsibilityBalance).length)
    add({
      key: "responsibility_balance",
      section: "responsibilities",
      field: "activity_balance",
      kind: "range",
      importance: "soft",
      operator: "between",
      value: Object.fromEntries(
        lines(value.responsibilityBalance)
          .map((entry) => {
            const [key, amount] = entry.split("=");
            return [key.trim(), Number(amount)];
          })
          .filter((entry) => entry[0] && Number.isFinite(entry[1]))
      ),
      weight: 70
    });
  if (value.careerPath !== "any")
    add({
      key: "career_path",
      section: "role",
      field: "career_path",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: [value.careerPath],
      weight: 70
    });
  if (value.minimumHandsOnPercent)
    add({
      key: "minimum_hands_on",
      section: "responsibilities",
      field: "hands_on_percent",
      kind: "number",
      importance: "soft",
      operator: "gte",
      value: Number(value.minimumHandsOnPercent),
      weight: 75
    });
  if (value.maximumTeamSize)
    add({
      key: "maximum_team_size",
      section: "responsibilities",
      field: "team_size",
      kind: "number",
      importance: "soft",
      operator: "lte",
      value: Number(value.maximumTeamSize),
      weight: 45
    });
  if (value.maximumOnCall)
    add({
      key: "maximum_on_call",
      section: "work_balance",
      field: "on_call",
      kind: "text",
      importance: "hard",
      operator: "contains",
      value: value.maximumOnCall,
      weight: 100
    });
  if (value.maximumTravelPercent)
    add({
      key: "maximum_travel",
      section: "work_balance",
      field: "travel_percent",
      kind: "number",
      importance: "hard",
      operator: "lte",
      value: Number(value.maximumTravelPercent),
      weight: 100
    });
  for (const [key, field, selected] of [
    ["customer_exposure", "customer_exposure", value.customerExposure],
    ["publication_freedom", "publication_freedom", value.publicationFreedom],
    ["open_source_freedom", "open_source_freedom", value.openSourceFreedom]
  ] as const)
    if (selected !== "any")
      add({
        key,
        section: "responsibilities",
        field,
        kind: "text",
        importance:
          selected === "required" || selected === "excluded" ? "hard" : "soft",
        operator: selected === "excluded" ? "excludes" : "contains",
        value: selected,
        weight: selected === "preferred" ? 60 : 100
      });
  if (value.minimumResearchPercent)
    add({
      key: "minimum_research_time",
      section: "responsibilities",
      field: "research_time_percent",
      kind: "number",
      importance: "soft",
      operator: "gte",
      value: Number(value.minimumResearchPercent),
      weight: 75
    });
  if (lines(value.employmentTypes).length)
    add({
      key: "employment_types",
      section: "workload",
      field: "employment_type",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.employmentTypes),
      weight: 70
    });
  if (lines(value.locations).length)
    add({
      key: "allowed_locations",
      section: "geography",
      field: "location",
      kind: "location",
      importance: "soft",
      operator: "in",
      value: lines(value.locations),
      weight: 75
    });
  if (lines(value.excludedLocations).length)
    add({
      key: "excluded_locations",
      section: "geography",
      field: "location",
      kind: "location",
      importance: "hard",
      operator: "not_in",
      value: lines(value.excludedLocations),
      weight: 100,
      flexibility: "none"
    });
  if (value.workModel !== "any")
    add({
      key: "work_model",
      section: "geography",
      field: "work_model",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: [value.workModel],
      weight: 75
    });
  if (value.maximumOfficeDays)
    add({
      key: "maximum_office_days",
      section: "geography",
      field: "office_days_per_week",
      kind: "number",
      importance: "hard",
      operator: "lte",
      value: Number(value.maximumOfficeDays),
      weight: 100
    });
  if (value.maximumCommuteMinutes)
    add({
      key: "maximum_commute",
      section: "geography",
      field: "commute_minutes",
      kind: "number",
      importance: "hard",
      operator: "lte",
      value: Number(value.maximumCommuteMinutes),
      weight: 100
    });
  if (value.relocation !== "unknown")
    add({
      key: "relocation",
      section: "geography",
      field: "relocation",
      kind: "text",
      importance: value.relocation === "unwilling" ? "hard" : "soft",
      operator: "eq",
      value: value.relocation,
      weight: value.relocation === "unwilling" ? 100 : 60
    });
  if (value.sponsorship !== "unknown")
    add({
      key: "sponsorship",
      section: "authorization",
      field: "sponsorship",
      kind: "text",
      importance: ["needed", "unacceptable"].includes(value.sponsorship)
        ? "hard"
        : "soft",
      operator: "eq",
      value: value.sponsorship,
      weight: ["needed", "unacceptable"].includes(value.sponsorship) ? 100 : 60
    });
  if (lines(value.scheduleConstraints).length)
    add({
      key: "schedule_constraints",
      section: "schedule",
      field: "schedule",
      kind: "set",
      importance: "hard",
      operator: "contains",
      value: lines(value.scheduleConstraints),
      weight: 100
    });
  if (lines(value.workingDays).length)
    add({
      key: "working_days",
      section: "schedule",
      field: "working_days",
      kind: "set",
      importance: "soft",
      operator: "in",
      value: lines(value.workingDays),
      weight: 65
    });
  if (value.timezoneOverlap)
    add({
      key: "timezone_overlap",
      section: "schedule",
      field: "timezone_overlap",
      kind: "text",
      importance: "soft",
      operator: "contains",
      value: value.timezoneOverlap,
      weight: 60
    });
  if (value.sideJobCompatibility !== "unknown")
    add({
      key: "side_job_compatibility",
      section: "schedule",
      field: "side_job_compatibility",
      kind: "text",
      importance: value.sideJobCompatibility === "required" ? "hard" : "soft",
      operator: "eq",
      value: value.sideJobCompatibility,
      weight: value.sideJobCompatibility === "required" ? 100 : 60
    });
  if (value.desiredDuration)
    add({
      key: "desired_duration",
      section: "workload",
      field: "duration",
      kind: "duration",
      importance: "soft",
      operator: "contains",
      value: value.desiredDuration,
      weight: 50
    });
  if (value.noticeValue)
    add({
      key: "notice_period",
      section: "availability",
      field: "notice_period",
      kind: "duration",
      importance: "hard",
      operator: "eq",
      value: { value: Number(value.noticeValue), unit: value.noticeUnit },
      weight: 100
    });
  if (value.earliestStartDate)
    add({
      key: "earliest_start",
      section: "availability",
      field: "earliest_start_date",
      kind: "text",
      importance: "hard",
      operator: "gte",
      value: value.earliestStartDate,
      weight: 100
    });
  if (value.preferredStartDate)
    add({
      key: "preferred_start",
      section: "availability",
      field: "preferred_start_date",
      kind: "text",
      importance: "soft",
      operator: "eq",
      value: value.preferredStartDate,
      weight: 60
    });
  if (lines(value.availabilityConditions).length)
    add({
      key: "availability_conditions",
      section: "availability",
      field: "conditions",
      kind: "set",
      importance: "hard",
      operator: "contains",
      value: lines(value.availabilityConditions),
      weight: 100
    });
  const money = (amount: string) => ({
    amount: Number(amount),
    currency: value.currency,
    basis: value.compensationBasis,
    period: "year",
    negotiable: value.compensationNegotiability === "negotiable",
    unknown: false
  });
  if (value.minimumCompensation)
    add({
      key: "minimum_compensation",
      section: "compensation",
      field: "base",
      kind: "money",
      importance: "hard",
      operator: "gte",
      value: money(value.minimumCompensation),
      weight: 100,
      flexibility: "low"
    });
  if (value.targetCompensation)
    add({
      key: "target_compensation",
      section: "compensation",
      field: "total",
      kind: "money",
      importance: "soft",
      operator: "gte",
      value: money(value.targetCompensation),
      weight: 75
    });
  if (value.stretchCompensation)
    add({
      key: "stretch_compensation",
      section: "compensation",
      field: "total",
      kind: "money",
      importance: "soft",
      operator: "gte",
      value: money(value.stretchCompensation),
      weight: 40,
      flexibility: "high"
    });
  if (lines(value.desiredBenefits).length)
    add({
      key: "desired_benefits",
      section: "benefits",
      field: "benefits",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.desiredBenefits),
      weight: 55
    });
  if (value.minimumHours)
    add({
      key: "minimum_weekly_hours",
      section: "workload",
      field: "weekly_hours",
      kind: "number",
      importance: "soft",
      operator: "gte",
      value: Number(value.minimumHours),
      weight: 50
    });
  if (value.maximumHours)
    add({
      key: "maximum_weekly_hours",
      section: "workload",
      field: "weekly_hours",
      kind: "number",
      importance: "hard",
      operator: "lte",
      value: Number(value.maximumHours),
      weight: 100,
      flexibility: "low"
    });
  if (lines(value.organizationPreferences).length)
    add({
      key: "organization_preferences",
      section: "organization",
      field: "preferred_characteristics",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.organizationPreferences),
      weight: 65
    });
  if (lines(value.organizationExclusions).length)
    add({
      key: "organization_exclusions",
      section: "organization",
      field: "excluded_characteristics",
      kind: "set",
      importance: "hard",
      operator: "excludes",
      value: lines(value.organizationExclusions),
      weight: 100
    });
  if (lines(value.cultureMissionEthics).length)
    add({
      key: "culture_mission_ethics",
      section: "organization",
      field: "culture_mission_ethics",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.cultureMissionEthics),
      weight: 70
    });
  if (lines(value.growthPriorities).length)
    add({
      key: "growth_priorities",
      section: "growth",
      field: "growth",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.growthPriorities),
      weight: 75
    });
  if (lines(value.futureRolePaths).length)
    add({
      key: "future_role_paths",
      section: "growth",
      field: "future_roles",
      kind: "set",
      importance: "soft",
      operator: "contains",
      value: lines(value.futureRolePaths),
      weight: 70
    });
  if (value.growthTimeHorizon)
    add({
      key: "growth_time_horizon",
      section: "growth",
      field: "time_horizon",
      kind: "duration",
      importance: "soft",
      operator: "eq",
      value: value.growthTimeHorizon,
      weight: 50
    });
  if (lines(value.disqualificationRules).length)
    add({
      key: "custom_disqualification_rules",
      section: "custom",
      field: "disqualification",
      kind: "text",
      importance: "hard",
      operator: "contains",
      value: lines(value.disqualificationRules),
      weight: 100,
      flexibility: "none",
      disqualificationRule: lines(value.disqualificationRules).join("; ")
    });
  const managedKeys = new Set([
    "desired_titles",
    "excluded_titles",
    "desired_functions",
    "excluded_functions",
    "role_families",
    "seniority_levels",
    "sectors",
    "technology_areas",
    "responsibility_balance",
    "career_path",
    "minimum_hands_on",
    "maximum_team_size",
    "maximum_on_call",
    "maximum_travel",
    "customer_exposure",
    "publication_freedom",
    "open_source_freedom",
    "minimum_research_time",
    "employment_types",
    "allowed_locations",
    "excluded_locations",
    "work_model",
    "maximum_office_days",
    "maximum_commute",
    "relocation",
    "sponsorship",
    "schedule_constraints",
    "working_days",
    "timezone_overlap",
    "side_job_compatibility",
    "desired_duration",
    "notice_period",
    "earliest_start",
    "preferred_start",
    "availability_conditions",
    "minimum_compensation",
    "target_compensation",
    "stretch_compensation",
    "desired_benefits",
    "minimum_weekly_hours",
    "maximum_weekly_hours",
    "organization_preferences",
    "organization_exclusions",
    "culture_mission_ethics",
    "growth_priorities",
    "future_role_paths",
    "growth_time_horizon",
    "custom_disqualification_rules"
  ]);
  const preserved = Array.isArray(previous?.criteria)
    ? (previous.criteria as WorkRecord[]).filter(
        (criterion) => !managedKeys.has(String(criterion.key))
      )
    : [];
  return {
    schemaVersion: 1,
    criteria: [...criteria, ...preserved],
    rankingWeights:
      previous?.rankingWeights && typeof previous.rankingWeights === "object"
        ? previous.rankingWeights
        : {},
    dealBreakers: lines(value.dealBreakers),
    acceptableTradeoffs: lines(value.tradeoffs),
    uncertaintyTolerance: value.uncertaintyTolerance,
    minimumExcitement: value.minimumExcitement
      ? Number(value.minimumExcitement)
      : null,
    includeKeywords: lines(value.includeKeywords),
    excludeKeywords: lines(value.excludeKeywords),
    requiredSources: lines(value.requiredSources),
    minimumConfidence: value.minimumConfidencePercent
      ? Number(value.minimumConfidencePercent) / 100
      : null
  };
}
export function criteriaDraftFromDocument(document?: WorkRecord): CriteriaDraft {
  if (!document) return { ...emptyCriteria };
  const entries = Array.isArray(document.criteria)
    ? (document.criteria as WorkRecord[])
    : [];
  const byKey = new Map(
    entries.map((criterion) => [String(criterion.key), criterion])
  );
  const value = (key: string) => byKey.get(key)?.value;
  const list = (key: string) =>
    Array.isArray(value(key))
      ? (value(key) as unknown[]).map(String).join("\n")
      : "";
  const text = (key: string) => (value(key) == null ? "" : String(value(key)));
  const selected = <T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T
  ) => (allowed.includes(text(key) as T) ? (text(key) as T) : fallback);
  const minimumCompensation = value("minimum_compensation") as
    | WorkRecord
    | undefined;
  const targetCompensation = value("target_compensation") as
    | WorkRecord
    | undefined;
  const stretchCompensation = value("stretch_compensation") as
    | WorkRecord
    | undefined;
  const notice = value("notice_period") as WorkRecord | undefined;
  const balance = value("responsibility_balance");
  return {
    ...emptyCriteria,
    desiredTitles: list("desired_titles"),
    excludedTitles: list("excluded_titles"),
    desiredFunctions: list("desired_functions"),
    excludedFunctions: list("excluded_functions"),
    roleFamilies: list("role_families"),
    seniorityLevels: list("seniority_levels"),
    sectors: list("sectors"),
    technologyAreas: list("technology_areas"),
    responsibilityBalance:
      balance && typeof balance === "object"
        ? Object.entries(balance as Record<string, unknown>)
            .map(([key, amount]) => `${key}=${String(amount)}`)
            .join("\n")
        : "",
    careerPath: selected(
      "career_path",
      ["any", "individual_contributor", "management"] as const,
      "any"
    ),
    minimumHandsOnPercent: text("minimum_hands_on"),
    maximumTeamSize: text("maximum_team_size"),
    maximumOnCall: text("maximum_on_call"),
    maximumTravelPercent: text("maximum_travel"),
    customerExposure: selected(
      "customer_exposure",
      ["any", "preferred", "required", "excluded"] as const,
      "any"
    ),
    publicationFreedom: selected(
      "publication_freedom",
      ["any", "preferred", "required"] as const,
      "any"
    ),
    openSourceFreedom: selected(
      "open_source_freedom",
      ["any", "preferred", "required"] as const,
      "any"
    ),
    minimumResearchPercent: text("minimum_research_time"),
    employmentTypes: list("employment_types"),
    locations: list("allowed_locations"),
    excludedLocations: list("excluded_locations"),
    workModel: selected(
      "work_model",
      ["any", "remote", "hybrid", "on_site"] as const,
      "any"
    ),
    maximumOfficeDays: text("maximum_office_days"),
    maximumCommuteMinutes: text("maximum_commute"),
    relocation: selected(
      "relocation",
      [
        "unknown",
        "unwilling",
        "possible",
        "willing",
        "required_support"
      ] as const,
      "unknown"
    ),
    sponsorship: selected(
      "sponsorship",
      [
        "unknown",
        "not_needed",
        "needed",
        "acceptable",
        "unacceptable"
      ] as const,
      "unknown"
    ),
    scheduleConstraints: list("schedule_constraints"),
    workingDays: list("working_days"),
    timezoneOverlap: text("timezone_overlap"),
    sideJobCompatibility: selected(
      "side_job_compatibility",
      ["unknown", "not_needed", "preferred", "required"] as const,
      "unknown"
    ),
    desiredDuration: text("desired_duration"),
    noticeValue: notice?.value == null ? "" : String(notice.value),
    noticeUnit: (["days", "weeks", "months"].includes(String(notice?.unit))
      ? notice?.unit
      : "months") as CriteriaDraft["noticeUnit"],
    earliestStartDate: text("earliest_start"),
    preferredStartDate: text("preferred_start"),
    availabilityConditions: list("availability_conditions"),
    minimumCompensation:
      minimumCompensation?.amount == null
        ? ""
        : String(minimumCompensation.amount),
    targetCompensation:
      targetCompensation?.amount == null
        ? ""
        : String(targetCompensation.amount),
    stretchCompensation:
      stretchCompensation?.amount == null
        ? ""
        : String(stretchCompensation.amount),
    currency: String(
      minimumCompensation?.currency ??
        targetCompensation?.currency ??
        stretchCompensation?.currency ??
        "CHF"
    ),
    compensationBasis: (["gross", "net", "unknown"].includes(
      String(minimumCompensation?.basis)
    )
      ? minimumCompensation?.basis
      : "gross") as CriteriaDraft["compensationBasis"],
    compensationNegotiability:
      minimumCompensation?.negotiable === true
        ? "negotiable"
        : minimumCompensation?.negotiable === false
          ? "fixed"
          : "unknown",
    desiredBenefits: list("desired_benefits"),
    minimumHours: text("minimum_weekly_hours"),
    maximumHours: text("maximum_weekly_hours"),
    organizationPreferences: list("organization_preferences"),
    organizationExclusions: list("organization_exclusions"),
    cultureMissionEthics: list("culture_mission_ethics"),
    growthPriorities: list("growth_priorities"),
    futureRolePaths: list("future_role_paths"),
    growthTimeHorizon: text("growth_time_horizon"),
    includeKeywords: Array.isArray(document.includeKeywords)
      ? document.includeKeywords.map(String).join("\n")
      : "",
    excludeKeywords: Array.isArray(document.excludeKeywords)
      ? document.excludeKeywords.map(String).join("\n")
      : "",
    requiredSources: Array.isArray(document.requiredSources)
      ? document.requiredSources.map(String).join("\n")
      : "",
    minimumConfidencePercent:
      document.minimumConfidence == null
        ? ""
        : String(Number(document.minimumConfidence) * 100),
    evidenceFreshnessDays: "",
    disqualificationRules: list("custom_disqualification_rules"),
    dealBreakers: Array.isArray(document.dealBreakers)
      ? document.dealBreakers.map(String).join("\n")
      : "",
    tradeoffs: Array.isArray(document.acceptableTradeoffs)
      ? document.acceptableTradeoffs.map(String).join("\n")
      : "",
    minimumExcitement:
      document.minimumExcitement == null
        ? ""
        : String(document.minimumExcitement),
    uncertaintyTolerance: (["low", "medium", "high"].includes(
      String(document.uncertaintyTolerance)
    )
      ? document.uncertaintyTolerance
      : "medium") as CriteriaDraft["uncertaintyTolerance"]
  };
}
