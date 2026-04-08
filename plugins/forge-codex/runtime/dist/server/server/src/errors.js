export class HttpError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
export function isHttpError(error) {
    return error instanceof HttpError;
}
