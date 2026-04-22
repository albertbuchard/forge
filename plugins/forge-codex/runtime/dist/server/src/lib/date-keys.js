function readPart(parts, type) {
    return parts.find((part) => part.type === type)?.value ?? "";
}
export function getRuntimeTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
export function formatDateKeyInTimeZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const year = readPart(parts, "year");
    const month = readPart(parts, "month");
    const day = readPart(parts, "day");
    return `${year}-${month}-${day}`;
}
export function formatLocalDateKey(date = new Date()) {
    return formatDateKeyInTimeZone(date, getRuntimeTimeZone());
}
