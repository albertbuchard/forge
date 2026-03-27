import { AbstractExternalManager } from "../base.js";
export class ApiGatewayManager extends AbstractExternalManager {
    name = "ApiGatewayManager";
    config = null;
    configure(config) {
        this.config = config;
    }
    getConfig() {
        return this.config;
    }
}
