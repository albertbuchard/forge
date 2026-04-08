export class ForgeApiError extends Error {
    status;
    code;
    details;
    requestPath;
    constructor(input) {
        super(input.message);
        this.name = "ForgeApiError";
        this.status = input.status;
        this.code = input.code;
        this.details = input.details ?? [];
        this.requestPath = input.requestPath;
    }
}
export function describeApiError(error) {
    if (error instanceof ForgeApiError) {
        return {
            title: `Request failed (${error.status})`,
            description: error.details.length > 0
                ? `${error.message} ${error.details.map((detail) => `${detail.path}: ${detail.message}`).join(" · ")}`
                : error.message,
            code: error.code
        };
    }
    if (error instanceof Error) {
        return {
            title: "Something went wrong",
            description: error.message,
            code: "unknown_error"
        };
    }
    return {
        title: "Something went wrong",
        description: "Unexpected API failure.",
        code: "unknown_error"
    };
}
