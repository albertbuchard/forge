import { resolveForgePath } from "./runtime-paths";
function sanitizeValue(value, depth = 0) {
    if (value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string") {
        return value;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack ?? null
        };
    }
    if (Array.isArray(value)) {
        if (depth >= 3) {
            return `[Array(${value.length})]`;
        }
        return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
    }
    if (value && typeof value === "object") {
        if (depth >= 3) {
            return "[Object]";
        }
        return Object.fromEntries(Object.entries(value)
            .slice(0, 30)
            .map(([key, entry]) => [key, sanitizeValue(entry, depth + 1)]));
    }
    return String(value);
}
function sanitizeDetails(details) {
    if (!details) {
        return {};
    }
    return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, sanitizeValue(value)]));
}
export async function publishUiDiagnosticLog(input) {
    try {
        await fetch(resolveForgePath("/api/v1/diagnostics/logs"), {
            method: "POST",
            credentials: "same-origin",
            keepalive: true,
            headers: {
                "content-type": "application/json",
                "x-forge-source": "ui"
            },
            body: JSON.stringify({
                ...input,
                source: input.source ?? "ui",
                details: sanitizeDetails(input.details)
            })
        });
    }
    catch {
        // Diagnostics should never break the user flow.
    }
}
export function createUiDiagnosticLogger(defaults) {
    return (input) => publishUiDiagnosticLog({
        ...defaults,
        ...input
    });
}
