import { AbstractManager } from "../base.js";

export class EventBusManager extends AbstractManager {
  readonly name = "EventBusManager";

  publish(_event: Record<string, unknown>) {
    return;
  }
}
