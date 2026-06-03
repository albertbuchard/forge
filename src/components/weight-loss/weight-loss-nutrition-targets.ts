import type { WeightLossViewData } from "@/lib/weight-loss-types";
import { numeric } from "./weight-loss-format";

type Sex = "male" | "female";

export type NutritionTargetRow = {
  id: string;
  label: string;
  target: string;
  unit?: string;
  note: string;
  source: string;
};

export type NutritionTargetGroups = {
  profile: {
    sex: Sex;
    ageYears: number;
    currentWeightKg: number;
    calorieTarget: number;
    activeBurnKcal: number | null;
    movementCaloriesKcal: number | null;
    restingEnergyKcal: number | null;
  };
  macros: NutritionTargetRow[];
  vitamins: NutritionTargetRow[];
  minerals: NutritionTargetRow[];
  sportLosses: NutritionTargetRow[];
  sportSummary: {
    trainingHours: number | null;
    fluidLossLiters: string;
    sodiumLossMg: string;
    potassiumLossMg: string;
    grossSportWeightEquivalentKgPerWeek: number | null;
  };
};

function parsePlanNote(notes: string | null | undefined, key: string) {
  if (!notes) {
    return null;
  }
  const match = notes.match(new RegExp(`${key}=([^;]+)`));
  return match?.[1]?.trim() ?? null;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "string" ? Number(value) : numeric(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function sexFromView(view: WeightLossViewData): Sex {
  const raw = parsePlanNote(view.target.notes, "sex");
  return raw === "female" ? "female" : "male";
}

function ageFromView(view: WeightLossViewData) {
  return asNumber(parsePlanNote(view.target.notes, "age_years"), 35);
}

function row(
  id: string,
  label: string,
  value: number | string,
  unit: string,
  note: string,
  source: string
): NutritionTargetRow {
  return {
    id,
    label,
    target: typeof value === "number" ? formatTarget(value) : value,
    unit,
    note,
    source
  };
}

function formatTarget(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function targetRange(min: number, max: number) {
  return `${formatTarget(min)}-${formatTarget(max)}`;
}

function fiberTarget(sex: Sex, ageYears: number, calories: number, stored: number) {
  const dri = sex === "male" ? (ageYears >= 51 ? 30 : 38) : ageYears >= 51 ? 21 : 25;
  return Math.max(stored, dri, Math.round((calories / 1000) * 14));
}

function linoleicTarget(sex: Sex, ageYears: number) {
  if (sex === "male") {
    return ageYears >= 51 ? 14 : 17;
  }
  return ageYears >= 51 ? 11 : 12;
}

function vitaminTargets(sex: Sex, ageYears: number) {
  const older = ageYears > 70;
  const over50 = ageYears >= 51;
  return [
    row("vitamin_a", "Vitamin A", sex === "male" ? 900 : 700, "ug RAE", "Retinol activity equivalent target.", "NASEM DRI"),
    row("vitamin_c", "Vitamin C", sex === "male" ? 90 : 75, "mg", "Adult RDA.", "NASEM DRI"),
    row("vitamin_d", "Vitamin D", older ? 20 : 15, "ug", "Assumes limited sun exposure; older adults need more.", "NASEM DRI"),
    row("vitamin_e", "Vitamin E", 15, "mg alpha-tocopherol", "Adult RDA.", "NASEM DRI"),
    row("vitamin_k", "Vitamin K", sex === "male" ? 120 : 90, "ug", "Adult AI.", "NASEM DRI"),
    row("thiamin_b1", "Thiamin B1", sex === "male" ? 1.2 : 1.1, "mg", "Adult RDA.", "NASEM DRI"),
    row("riboflavin_b2", "Riboflavin B2", sex === "male" ? 1.3 : 1.1, "mg", "Adult RDA.", "NASEM DRI"),
    row("niacin_b3", "Niacin B3", sex === "male" ? 16 : 14, "mg NE", "Adult RDA.", "NASEM DRI"),
    row("vitamin_b6", "Vitamin B6", over50 ? (sex === "male" ? 1.7 : 1.5) : 1.3, "mg", "RDA rises after 50.", "NASEM DRI"),
    row("folate", "Folate", 400, "ug DFE", "Adult RDA.", "NASEM DRI"),
    row("vitamin_b12", "Vitamin B12", 2.4, "ug", "Adult RDA.", "NASEM DRI"),
    row("pantothenic_acid", "Pantothenic acid", 5, "mg", "Adult AI.", "NASEM DRI"),
    row("biotin", "Biotin", 30, "ug", "Adult AI.", "NASEM DRI"),
    row("choline", "Choline", sex === "male" ? 550 : 425, "mg", "Adult AI.", "NASEM DRI")
  ];
}

function mineralTargets(sex: Sex, ageYears: number) {
  const calcium = ageYears > 70 || (sex === "female" && ageYears >= 51) ? 1200 : 1000;
  const magnesium = sex === "male" ? (ageYears >= 31 ? 420 : 400) : ageYears >= 31 ? 320 : 310;
  const chromium = sex === "male" ? (ageYears >= 51 ? 30 : 35) : ageYears >= 51 ? 20 : 25;
  const chloride = ageYears >= 71 ? 1800 : ageYears >= 51 ? 2000 : 2300;
  return [
    row("calcium", "Calcium", calcium, "mg", "Bone and muscle target; higher for older adults and women 51+.", "NASEM DRI"),
    row("iron", "Iron", sex === "female" && ageYears <= 50 ? 18 : 8, "mg", "Menstruating-age female target is higher.", "NASEM DRI"),
    row("magnesium", "Magnesium", magnesium, "mg", "Adult RDA.", "NASEM DRI"),
    row("phosphorus", "Phosphorus", 700, "mg", "Adult RDA.", "NASEM DRI"),
    row("zinc", "Zinc", sex === "male" ? 11 : 8, "mg", "Adult RDA.", "NASEM DRI"),
    row("iodine", "Iodine", 150, "ug", "Adult RDA.", "NASEM DRI"),
    row("selenium", "Selenium", 55, "ug", "Adult RDA.", "NASEM DRI"),
    row("copper", "Copper", 0.9, "mg", "Adult RDA.", "NASEM DRI"),
    row("manganese", "Manganese", sex === "male" ? 2.3 : 1.8, "mg", "Adult AI.", "NASEM DRI"),
    row("chromium", "Chromium", chromium, "ug", "Adult AI.", "NASEM DRI"),
    row("molybdenum", "Molybdenum", 45, "ug", "Adult RDA.", "NASEM DRI"),
    row("fluoride", "Fluoride", sex === "male" ? 4 : 3, "mg", "Adult AI.", "NASEM DRI"),
    row("chloride", "Chloride", chloride, "mg", "Adult AI.", "NASEM DRI"),
    row("potassium", "Potassium", sex === "male" ? 3400 : 2600, "mg", "Current adult AI for non-pregnant adults.", "NASEM DRI"),
    row("sodium_limit", "Sodium ceiling", 2300, "mg max", "Default daily ceiling unless medically individualized.", "U.S. Dietary Guidelines")
  ];
}

export function buildNutritionTargetGroups(view: WeightLossViewData): NutritionTargetGroups {
  const sex = sexFromView(view);
  const ageYears = ageFromView(view);
  const currentWeightKg = asNumber(view.weightTrend.latestWeightKg, 80);
  const calorieTarget = Math.max(1, asNumber(view.target.calorieTarget, 2200));
  const protein = asNumber(view.target.proteinGramsTarget, currentWeightKg * 1.8);
  const carbs = Math.max(130, asNumber(view.target.carbohydrateGramsTarget, (calorieTarget * 0.45) / 4));
  const fat = Math.max(currentWeightKg * 0.6, asNumber(view.target.fatGramsTarget, (calorieTarget * 0.25) / 9));
  const fiber = fiberTarget(sex, ageYears, calorieTarget, asNumber(view.target.fiberGramsTarget, 0));
  const activeBurnKcal =
    numeric(view.energyModel.activeBurnKcal) ??
    numeric(view.energyModel.activeEnergyCalories) ??
    null;
  const movementCaloriesKcal = numeric(view.energyModel.movementCaloriesKcal);
  const restingEnergyKcal = numeric(view.energyModel.restingEnergyCalories);
  const trainingHours = activeBurnKcal != null ? Math.min(4, Math.max(0.1, activeBurnKcal / 500)) : null;
  const fluidMin = trainingHours != null ? trainingHours * 0.4 : null;
  const fluidMax = trainingHours != null ? trainingHours * 0.8 : null;
  const sodiumMin = fluidMin != null ? fluidMin * 500 : null;
  const sodiumMax = fluidMax != null ? fluidMax * 1000 : null;
  const potassiumMin = fluidMin != null ? fluidMin * 78 : null;
  const potassiumMax = fluidMax != null ? fluidMax * 312 : null;
  const grossSportWeightEquivalentKgPerWeek =
    activeBurnKcal != null ? (activeBurnKcal * 7) / 7700 : null;

  return {
    profile: {
      sex,
      ageYears,
      currentWeightKg,
      calorieTarget,
      activeBurnKcal,
      movementCaloriesKcal,
      restingEnergyKcal
    },
    macros: [
      row("calories", "Calories", calorieTarget, "kcal", "Plan target from BMR, active burn, and chosen weekly rate.", "Forge plan"),
      row("protein", "Protein", protein, "g", "Higher than the population RDA to preserve lean mass during weight change.", "ISSN + Forge plan"),
      row("carbohydrate", "Carbohydrate", carbs, "g", "Remainder fuel with a 130g/day floor and AMDR context.", "NASEM DRI"),
      row("fat", "Total fat", fat, "g", "Practical floor: at least 0.6g/kg or 20% of calories.", "NASEM AMDR + Forge plan"),
      row("fiber", "Fiber", fiber, "g", "Uses sex/age AI and 14g per 1000 kcal planning rule.", "NASEM DRI"),
      row("saturated_fat", "Saturated fat", calorieTarget * 0.1 / 9, "g max", "Keep below 10% of energy.", "U.S. Dietary Guidelines"),
      row("added_sugar", "Added sugar", calorieTarget * 0.1 / 4, "g max", "Keep below 10% of energy; lower is better when feasible.", "U.S. Dietary Guidelines"),
      row("linoleic_acid", "Linoleic acid", linoleicTarget(sex, ageYears), "g", "Essential n-6 fatty acid AI.", "NASEM DRI"),
      row("ala", "ALA omega-3", sex === "male" ? 1.6 : 1.1, "g", "Essential n-3 fatty acid AI.", "NASEM DRI"),
      row("water", "Total water", sex === "male" ? 3.7 : 2.7, "L", "All beverages and food water before extra training replacement.", "NASEM DRI")
    ],
    vitamins: vitaminTargets(sex, ageYears),
    minerals: mineralTargets(sex, ageYears),
    sportLosses: [
      row("training_time", "Estimated training time", trainingHours != null ? trainingHours : "n/a", "h/day", "Derived from active burn at roughly 500 kcal/h.", "Forge sport-loss model"),
      row("sweat_fluid", "Expected sweat fluid", fluidMin != null && fluidMax != null ? targetRange(fluidMin, fluidMax) : "n/a", "L/day", "Planning range uses 0.4-0.8 L/h; measure body mass change to calibrate.", "ACSM"),
      row("sweat_sodium", "Expected sweat sodium", sodiumMin != null && sodiumMax != null ? targetRange(sodiumMin, sodiumMax) : "n/a", "mg/day", "Sodium varies widely; this uses a conservative range around common sweat sodium values.", "ACSM + Sports Medicine review"),
      row("sweat_potassium", "Expected sweat potassium", potassiumMin != null && potassiumMax != null ? targetRange(potassiumMin, potassiumMax) : "n/a", "mg/day", "Potassium is usually much smaller than sodium but useful for long/hot sessions.", "Sports Medicine review"),
      row("gross_sport_equivalent", "Gross sport burn equivalent", grossSportWeightEquivalentKgPerWeek != null ? grossSportWeightEquivalentKgPerWeek : "n/a", "kg/week", "Energy equivalent if the active burn were not eaten back; the plan may already include it.", "7700 kcal/kg model")
    ],
    sportSummary: {
      trainingHours,
      fluidLossLiters: fluidMin != null && fluidMax != null ? targetRange(fluidMin, fluidMax) : "n/a",
      sodiumLossMg: sodiumMin != null && sodiumMax != null ? targetRange(sodiumMin, sodiumMax) : "n/a",
      potassiumLossMg: potassiumMin != null && potassiumMax != null ? targetRange(potassiumMin, potassiumMax) : "n/a",
      grossSportWeightEquivalentKgPerWeek
    }
  };
}
