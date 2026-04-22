import { z } from "zod";
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const workoutActivityDescriptorSchema = z.object({
    sourceSystem: z.string().trim().min(1),
    providerActivityType: z.string().trim().min(1),
    providerRawValue: z.number().int().nullable().optional(),
    canonicalKey: z.string().trim().min(1),
    canonicalLabel: z.string().trim().min(1),
    familyKey: z.string().trim().min(1),
    familyLabel: z.string().trim().min(1),
    isFallback: z.boolean().default(false)
});
export const workoutMetricSchema = z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    category: z.string().trim().min(1),
    unit: z.string().trim().min(1).default("count"),
    statistic: z.string().trim().min(1).default("value"),
    value: scalarSchema,
    startedAt: z.string().datetime().nullable().optional(),
    endedAt: z.string().datetime().nullable().optional()
});
export const workoutEventSchema = z.object({
    type: z.string().trim().min(1),
    label: z.string().trim().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().nonnegative().default(0),
    metadata: z.record(z.string(), scalarSchema).default({})
});
export const workoutComponentSchema = z.object({
    externalUid: z.string().trim().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().nonnegative().default(0),
    activity: workoutActivityDescriptorSchema,
    metrics: z.array(workoutMetricSchema).default([]),
    metadata: z.record(z.string(), scalarSchema).default({})
});
export const workoutDetailsSchema = z.object({
    sourceSystem: z.string().trim().min(1),
    metrics: z.array(workoutMetricSchema).default([]),
    events: z.array(workoutEventSchema).default([]),
    components: z.array(workoutComponentSchema).default([]),
    metadata: z.record(z.string(), scalarSchema).default({})
});
const APPLE_HEALTH_ACTIVITY_TYPES = new Map([
    [1, { key: "american_football", label: "American football" }],
    [2, { key: "archery", label: "Archery" }],
    [3, { key: "australian_football", label: "Australian football" }],
    [4, { key: "badminton", label: "Badminton" }],
    [5, { key: "baseball", label: "Baseball" }],
    [6, { key: "basketball", label: "Basketball" }],
    [7, { key: "bowling", label: "Bowling" }],
    [8, { key: "boxing", label: "Boxing" }],
    [9, { key: "climbing", label: "Climbing" }],
    [10, { key: "cricket", label: "Cricket" }],
    [11, { key: "cross_training", label: "Cross training" }],
    [12, { key: "curling", label: "Curling" }],
    [13, { key: "cycling", label: "Cycling" }],
    [14, { key: "dance", label: "Dance" }],
    [15, { key: "dance_inspired_training", label: "Dance-inspired training" }],
    [16, { key: "elliptical", label: "Elliptical" }],
    [17, { key: "equestrian_sports", label: "Equestrian sports" }],
    [18, { key: "fencing", label: "Fencing" }],
    [19, { key: "fishing", label: "Fishing" }],
    [20, { key: "functional_strength_training", label: "Functional strength training" }],
    [21, { key: "golf", label: "Golf" }],
    [22, { key: "gymnastics", label: "Gymnastics" }],
    [23, { key: "handball", label: "Handball" }],
    [24, { key: "hiking", label: "Hiking" }],
    [25, { key: "hockey", label: "Hockey" }],
    [26, { key: "hunting", label: "Hunting" }],
    [27, { key: "lacrosse", label: "Lacrosse" }],
    [28, { key: "martial_arts", label: "Martial arts" }],
    [29, { key: "mind_and_body", label: "Mind and body" }],
    [30, { key: "mixed_metabolic_cardio_training", label: "Mixed metabolic cardio training" }],
    [31, { key: "paddle_sports", label: "Paddle sports" }],
    [32, { key: "play", label: "Play" }],
    [33, { key: "preparation_and_recovery", label: "Preparation and recovery" }],
    [34, { key: "racquetball", label: "Racquetball" }],
    [35, { key: "rowing", label: "Rowing" }],
    [36, { key: "rugby", label: "Rugby" }],
    [37, { key: "running", label: "Running" }],
    [38, { key: "sailing", label: "Sailing" }],
    [39, { key: "skating_sports", label: "Skating sports" }],
    [40, { key: "snow_sports", label: "Snow sports" }],
    [41, { key: "soccer", label: "Soccer" }],
    [42, { key: "softball", label: "Softball" }],
    [43, { key: "squash", label: "Squash" }],
    [44, { key: "stair_climbing", label: "Stair climbing" }],
    [45, { key: "surfing_sports", label: "Surfing sports" }],
    [46, { key: "swimming", label: "Swimming" }],
    [47, { key: "table_tennis", label: "Table tennis" }],
    [48, { key: "tennis", label: "Tennis" }],
    [49, { key: "track_and_field", label: "Track and field" }],
    [50, { key: "traditional_strength_training", label: "Traditional strength training" }],
    [51, { key: "volleyball", label: "Volleyball" }],
    [52, { key: "walking", label: "Walking" }],
    [53, { key: "water_fitness", label: "Water fitness" }],
    [54, { key: "water_polo", label: "Water polo" }],
    [55, { key: "water_sports", label: "Water sports" }],
    [56, { key: "wrestling", label: "Wrestling" }],
    [57, { key: "yoga", label: "Yoga" }],
    [58, { key: "barre", label: "Barre" }],
    [59, { key: "core_training", label: "Core training" }],
    [60, { key: "cross_country_skiing", label: "Cross-country skiing" }],
    [61, { key: "downhill_skiing", label: "Downhill skiing" }],
    [62, { key: "flexibility", label: "Flexibility" }],
    [63, { key: "high_intensity_interval_training", label: "High-intensity interval training" }],
    [64, { key: "jump_rope", label: "Jump rope" }],
    [65, { key: "kickboxing", label: "Kickboxing" }],
    [66, { key: "pilates", label: "Pilates" }],
    [67, { key: "snowboarding", label: "Snowboarding" }],
    [68, { key: "stairs", label: "Stairs" }],
    [69, { key: "step_training", label: "Step training" }],
    [70, { key: "wheelchair_walk_pace", label: "Wheelchair walk pace" }],
    [71, { key: "wheelchair_run_pace", label: "Wheelchair run pace" }],
    [72, { key: "tai_chi", label: "Tai chi" }],
    [73, { key: "mixed_cardio", label: "Mixed cardio" }],
    [74, { key: "hand_cycling", label: "Hand cycling" }],
    [75, { key: "disc_sports", label: "Disc sports" }],
    [76, { key: "fitness_gaming", label: "Fitness gaming" }],
    [77, { key: "cardio_dance", label: "Cardio dance" }],
    [78, { key: "social_dance", label: "Social dance" }],
    [79, { key: "pickleball", label: "Pickleball" }],
    [80, { key: "cooldown", label: "Cooldown" }],
    [82, { key: "swim_bike_run", label: "Swim-bike-run" }],
    [83, { key: "transition", label: "Transition" }],
    [84, { key: "underwater_diving", label: "Underwater diving" }],
    [3000, { key: "other", label: "Other" }]
]);
const CARDIO_KEYS = new Set([
    "walking",
    "running",
    "cycling",
    "rowing",
    "elliptical",
    "hiking",
    "mixed_cardio",
    "mixed_metabolic_cardio_training",
    "high_intensity_interval_training",
    "jump_rope",
    "stair_climbing",
    "stairs",
    "step_training",
    "cross_country_skiing",
    "downhill_skiing",
    "snowboarding",
    "hand_cycling",
    "wheelchair_walk_pace",
    "wheelchair_run_pace",
    "track_and_field",
    "cross_training",
    "cardio_dance",
    "fitness_gaming",
    "swim_bike_run",
    "transition"
]);
const STRENGTH_KEYS = new Set([
    "traditional_strength_training",
    "functional_strength_training",
    "core_training",
    "cross_training",
    "climbing"
]);
const MOBILITY_KEYS = new Set([
    "barre",
    "pilates",
    "flexibility",
    "preparation_and_recovery",
    "cooldown"
]);
const MINDFUL_KEYS = new Set([
    "mind_and_body",
    "yoga",
    "tai_chi"
]);
const WATER_KEYS = new Set([
    "swimming",
    "water_fitness",
    "water_polo",
    "water_sports",
    "paddle_sports",
    "surfing_sports",
    "sailing",
    "underwater_diving"
]);
const TEAM_SPORT_KEYS = new Set([
    "american_football",
    "australian_football",
    "baseball",
    "basketball",
    "cricket",
    "handball",
    "hockey",
    "lacrosse",
    "rugby",
    "soccer",
    "softball",
    "volleyball",
    "water_polo"
]);
const RACKET_KEYS = new Set([
    "badminton",
    "pickleball",
    "racquetball",
    "squash",
    "table_tennis",
    "tennis"
]);
const COMBAT_KEYS = new Set([
    "boxing",
    "kickboxing",
    "martial_arts",
    "wrestling",
    "fencing"
]);
const WINTER_KEYS = new Set([
    "cross_country_skiing",
    "downhill_skiing",
    "snow_sports",
    "snowboarding",
    "curling"
]);
function cleanString(value) {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}
function humanizeKey(value) {
    return value
        .trim()
        .replace(/^activity_/i, "")
        .replaceAll("_", " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function normalizeCanonicalKey(value) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll("-", "_")
        .replace(/\s+/g, "_");
}
function resolveActivityFamily(key) {
    const normalized = normalizeCanonicalKey(key);
    if (CARDIO_KEYS.has(normalized)) {
        return { familyKey: "cardio", familyLabel: "Cardio" };
    }
    if (STRENGTH_KEYS.has(normalized)) {
        return { familyKey: "strength", familyLabel: "Strength" };
    }
    if (MOBILITY_KEYS.has(normalized)) {
        return { familyKey: "mobility", familyLabel: "Mobility" };
    }
    if (MINDFUL_KEYS.has(normalized)) {
        return { familyKey: "mindful", familyLabel: "Mindful" };
    }
    if (WATER_KEYS.has(normalized)) {
        return { familyKey: "water", familyLabel: "Water" };
    }
    if (TEAM_SPORT_KEYS.has(normalized)) {
        return { familyKey: "team_sport", familyLabel: "Team sport" };
    }
    if (RACKET_KEYS.has(normalized)) {
        return { familyKey: "racket", familyLabel: "Racket" };
    }
    if (COMBAT_KEYS.has(normalized)) {
        return { familyKey: "combat", familyLabel: "Combat" };
    }
    if (WINTER_KEYS.has(normalized)) {
        return { familyKey: "winter", familyLabel: "Winter" };
    }
    if (normalized.includes("dance") ||
        normalized === "play" ||
        normalized === "disc_sports" ||
        normalized === "golf" ||
        normalized === "gymnastics" ||
        normalized === "bowling") {
        return { familyKey: "recreation", familyLabel: "Recreation" };
    }
    return { familyKey: "other", familyLabel: "Other" };
}
function inferSourceSystem(source, sourceType, provenance) {
    const fromProvenance = cleanString(provenance?.sourceSystem);
    if (fromProvenance) {
        return fromProvenance;
    }
    if (source === "apple_health" || sourceType.includes("healthkit")) {
        return "apple_health";
    }
    if (source === "forge_habit" || source === "manual" || sourceType === "manual") {
        return "forge";
    }
    return cleanString(sourceType) ?? cleanString(source) ?? "unknown";
}
function buildFallbackActivity(sourceSystem, workoutType, providerActivityType = "generic_workout_type", providerRawValue = null, isFallback = false) {
    const canonicalKey = normalizeCanonicalKey(workoutType.length > 0 ? workoutType : "workout");
    const canonicalLabel = humanizeKey(canonicalKey);
    const family = resolveActivityFamily(canonicalKey);
    return {
        sourceSystem,
        providerActivityType,
        providerRawValue,
        canonicalKey,
        canonicalLabel,
        familyKey: family.familyKey,
        familyLabel: family.familyLabel,
        isFallback
    };
}
function normalizeAppleHealthActivity(workoutType, existingActivity) {
    if (existingActivity?.sourceSystem === "apple_health") {
        const family = resolveActivityFamily(existingActivity.canonicalKey);
        return {
            ...existingActivity,
            familyKey: family.familyKey,
            familyLabel: family.familyLabel
        };
    }
    const rawMatch = /^activity_(\d+)$/i.exec(workoutType.trim());
    const rawValue = rawMatch ? Number(rawMatch[1]) : null;
    if (rawValue != null) {
        const catalog = APPLE_HEALTH_ACTIVITY_TYPES.get(rawValue);
        if (catalog) {
            const family = resolveActivityFamily(catalog.key);
            return {
                sourceSystem: "apple_health",
                providerActivityType: "hk_workout_activity_type",
                providerRawValue: rawValue,
                canonicalKey: catalog.key,
                canonicalLabel: catalog.label,
                familyKey: family.familyKey,
                familyLabel: family.familyLabel,
                isFallback: false
            };
        }
    }
    const normalizedKey = normalizeCanonicalKey(workoutType);
    for (const [providerRawValue, catalog] of APPLE_HEALTH_ACTIVITY_TYPES.entries()) {
        if (catalog.key === normalizedKey) {
            const family = resolveActivityFamily(catalog.key);
            return {
                sourceSystem: "apple_health",
                providerActivityType: "hk_workout_activity_type",
                providerRawValue,
                canonicalKey: catalog.key,
                canonicalLabel: catalog.label,
                familyKey: family.familyKey,
                familyLabel: family.familyLabel,
                isFallback: false
            };
        }
    }
    return buildFallbackActivity("apple_health", normalizedKey, "hk_workout_activity_type", rawValue, true);
}
const workoutSourceAdapters = new Map([
    [
        "apple_health",
        {
            sourceSystem: "apple_health",
            normalizeActivity: ({ workoutType, existingActivity }) => normalizeAppleHealthActivity(workoutType, existingActivity)
        }
    ],
    [
        "forge",
        {
            sourceSystem: "forge",
            normalizeActivity: ({ workoutType, existingActivity }) => {
                if (existingActivity) {
                    return {
                        ...existingActivity,
                        ...resolveActivityFamily(existingActivity.canonicalKey)
                    };
                }
                return buildFallbackActivity("forge", workoutType, "forge_workout_type");
            }
        }
    ]
]);
function getWorkoutSourceAdapter(sourceSystem) {
    return (workoutSourceAdapters.get(sourceSystem) ??
        {
            sourceSystem,
            normalizeActivity: ({ workoutType, existingActivity }) => {
                if (existingActivity) {
                    return {
                        ...existingActivity,
                        ...resolveActivityFamily(existingActivity.canonicalKey)
                    };
                }
                return buildFallbackActivity(sourceSystem, workoutType, "generic_workout_type");
            }
        });
}
function normalizeWorkoutDetails(sourceSystem, value) {
    const parsed = workoutDetailsSchema.safeParse(value);
    if (!parsed.success) {
        return {
            sourceSystem,
            metrics: [],
            events: [],
            components: [],
            metadata: {}
        };
    }
    return {
        ...parsed.data,
        sourceSystem,
        metrics: [...parsed.data.metrics].sort((left, right) => {
            if (left.category === right.category) {
                return left.label.localeCompare(right.label);
            }
            return left.category.localeCompare(right.category);
        }),
        events: [...parsed.data.events].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
        components: [...parsed.data.components].sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    };
}
export function buildWorkoutSessionPresentation(input) {
    const provenance = input.provenance ?? {};
    const derived = input.derived ?? {};
    const sourceSystem = inferSourceSystem(input.source, input.sourceType, provenance);
    const storedActivity = workoutActivityDescriptorSchema.safeParse(derived.activity).success
        ? workoutActivityDescriptorSchema.parse(derived.activity)
        : workoutActivityDescriptorSchema.safeParse(provenance.activity).success
            ? workoutActivityDescriptorSchema.parse(provenance.activity)
            : null;
    const adapter = getWorkoutSourceAdapter(sourceSystem);
    const activity = adapter.normalizeActivity({
        workoutType: input.workoutType,
        existingActivity: storedActivity
    });
    const details = normalizeWorkoutDetails(sourceSystem, derived.details ?? provenance.details);
    return {
        sourceSystem,
        sourceBundleIdentifier: cleanString(provenance.sourceBundleIdentifier),
        sourceProductType: cleanString(provenance.sourceProductType),
        workoutType: activity.canonicalKey,
        workoutTypeLabel: activity.canonicalLabel,
        activityFamily: activity.familyKey,
        activityFamilyLabel: activity.familyLabel,
        activity,
        details
    };
}
export function buildWorkoutSessionPersistenceSeed(input) {
    const sourceSystem = cleanString(input.sourceSystem) ??
        inferSourceSystem(input.source, input.sourceType, undefined);
    const parsedActivity = workoutActivityDescriptorSchema.safeParse(input.activity);
    const adapter = getWorkoutSourceAdapter(sourceSystem);
    const activity = adapter.normalizeActivity({
        workoutType: input.workoutType,
        existingActivity: parsedActivity.success ? parsedActivity.data : null
    });
    const details = normalizeWorkoutDetails(sourceSystem, input.details);
    return {
        sourceSystem,
        sourceBundleIdentifier: cleanString(input.sourceBundleIdentifier),
        sourceProductType: cleanString(input.sourceProductType),
        activity,
        details
    };
}
