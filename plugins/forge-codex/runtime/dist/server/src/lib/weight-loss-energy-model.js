export const HALL_NIDDK_LINEAR_WEIGHT_MODEL = {
    id: "hall_niddk_linearized_adult_12w",
    label: "Hall/NIDDK linearized adult model",
    defaultPlanningHorizonDays: 84,
    steadyStateKcalPerKgPerDay: 10 / 0.45359237,
    timeConstantDays: 365,
    staticEnergyDensityKcalPerKg: 7700
};
function positiveFinite(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : null;
}
export function hallNiddkWeightModelParameters(options = {}) {
    const planningHorizonDays = positiveFinite(options.planningHorizonDays) ??
        HALL_NIDDK_LINEAR_WEIGHT_MODEL.defaultPlanningHorizonDays;
    const timeConstantDays = positiveFinite(options.timeConstantDays) ??
        HALL_NIDDK_LINEAR_WEIGHT_MODEL.timeConstantDays;
    const steadyStateKcalPerKgPerDay = positiveFinite(options.steadyStateKcalPerKgPerDay) ??
        HALL_NIDDK_LINEAR_WEIGHT_MODEL.steadyStateKcalPerKgPerDay;
    const responseFraction = 1 - Math.exp(-planningHorizonDays / timeConstantDays);
    return {
        planningHorizonDays,
        timeConstantDays,
        steadyStateKcalPerKgPerDay,
        responseFraction
    };
}
export function hallNiddkWeeklyRateKgToDailyEnergyAdjustment(weeklyRateKg, options = {}) {
    if (typeof weeklyRateKg !== "number" || !Number.isFinite(weeklyRateKg)) {
        return null;
    }
    if (weeklyRateKg === 0) {
        return 0;
    }
    const parameters = hallNiddkWeightModelParameters(options);
    if (parameters.responseFraction <= 0) {
        return null;
    }
    const targetChangeKg = weeklyRateKg * (parameters.planningHorizonDays / 7);
    return ((targetChangeKg * parameters.steadyStateKcalPerKgPerDay) /
        parameters.responseFraction);
}
export function hallNiddkDailyEnergyAdjustmentToAverageWeeklyRateKg(dailyEnergyAdjustmentKcal, options = {}) {
    if (typeof dailyEnergyAdjustmentKcal !== "number" ||
        !Number.isFinite(dailyEnergyAdjustmentKcal)) {
        return null;
    }
    if (dailyEnergyAdjustmentKcal === 0) {
        return 0;
    }
    const parameters = hallNiddkWeightModelParameters(options);
    const totalChangeKg = (dailyEnergyAdjustmentKcal / parameters.steadyStateKcalPerKgPerDay) *
        parameters.responseFraction;
    return totalChangeKg / (parameters.planningHorizonDays / 7);
}
export function staticKgRateToDailyEnergyAdjustment(weeklyRateKg) {
    if (typeof weeklyRateKg !== "number" || !Number.isFinite(weeklyRateKg)) {
        return null;
    }
    return ((weeklyRateKg *
        HALL_NIDDK_LINEAR_WEIGHT_MODEL.staticEnergyDensityKcalPerKg) /
        7);
}
