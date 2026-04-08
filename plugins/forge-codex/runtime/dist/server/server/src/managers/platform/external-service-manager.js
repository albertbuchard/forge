import { AbstractManager } from "../base.js";
export class ExternalServiceManager extends AbstractManager {
    name = "ExternalServiceManager";
    providers = new Map();
    register(name, metadata) {
        this.providers.set(name, metadata);
    }
    list() {
        return [...this.providers.entries()].map(([name, metadata]) => ({ name, ...metadata }));
    }
}
