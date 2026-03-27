import { ManagerError } from "./contracts.js";
export function isManagerError(value) {
    return value instanceof ManagerError;
}
