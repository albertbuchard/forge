function readHostnameOrAddress(input) {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname.toLowerCase();
    }
    catch {
        return trimmed
            .replace(/^\[/, "")
            .replace(/\]$/, "")
            .split(":")[0]
            .toLowerCase();
    }
}
function isTailscaleIpv4(hostname) {
    const match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        return false;
    }
    const octets = match.slice(1).map((value) => Number(value));
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return false;
    }
    const [a, b] = octets;
    return a === 100 && b >= 64 && b <= 127;
}
export function isTrustedOperatorNetworkEntry(input) {
    const hostname = readHostnameOrAddress(input);
    if (!hostname) {
        return false;
    }
    return (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".ts.net") ||
        isTailscaleIpv4(hostname));
}
