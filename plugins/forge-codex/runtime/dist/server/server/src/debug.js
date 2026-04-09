function isTruthyFlag(value) {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return (normalized === "1" ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "on");
}
export function isForgeDebugLoggingEnabled(env = process.env) {
    return isTruthyFlag(env.FORGE_DEBUG_LOGS);
}
export function logForgeDebug(message, env = process.env) {
    if (!isForgeDebugLoggingEnabled(env)) {
        return;
    }
    console.info(message);
}
