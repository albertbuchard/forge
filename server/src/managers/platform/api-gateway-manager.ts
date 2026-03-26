import { AbstractExternalManager } from "../base.js";

export type ApiGatewayProviderConfig = {
  baseUrl: string;
  timeoutMs: number;
};

export class ApiGatewayManager extends AbstractExternalManager<ApiGatewayProviderConfig> {
  readonly name = "ApiGatewayManager";
  private config: ApiGatewayProviderConfig | null = null;

  configure(config: ApiGatewayProviderConfig) {
    this.config = config;
  }

  getConfig() {
    return this.config;
  }
}
