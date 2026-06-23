import { AbstractManager } from "../base.js";

export class HealthManager extends AbstractManager {
  readonly name = "HealthManager";

  summarize(input: Record<string, unknown>) {
    return input;
  }
}
