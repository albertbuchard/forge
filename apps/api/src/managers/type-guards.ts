import { ManagerError } from "./contracts.js";

export function isManagerError(value: unknown): value is ManagerError {
  return value instanceof ManagerError;
}
