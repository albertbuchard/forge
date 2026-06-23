import { AbstractManager } from "../base.js";

export class ExternalServiceManager extends AbstractManager {
  readonly name = "ExternalServiceManager";
  private readonly providers = new Map<string, Record<string, unknown>>();

  register(name: string, metadata: Record<string, unknown>) {
    this.providers.set(name, metadata);
  }

  list() {
    return [...this.providers.entries()].map(([name, metadata]) => ({ name, ...metadata }));
  }
}
