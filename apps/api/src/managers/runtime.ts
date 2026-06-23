import { ConfigurationManager } from "./platform/configuration-manager.js";
import { SecretsManager } from "./platform/secrets-manager.js";
import { DatabaseManager } from "./platform/database-manager.js";
import { TransactionManager } from "./platform/transaction-manager.js";
import { MigrationManager } from "./platform/migration-manager.js";
import { StorageManager } from "./platform/storage-manager.js";
import { AuditManager } from "./platform/audit-manager.js";
import { SessionManager } from "./platform/session-manager.js";
import { TokenManager } from "./platform/token-manager.js";
import { AuthenticationManager } from "./platform/authentication-manager.js";
import { AuthorizationManager } from "./platform/authorization-manager.js";
import { EventBusManager } from "./platform/event-bus-manager.js";
import { HealthManager } from "./platform/health-manager.js";
import { BackgroundJobManager } from "./platform/background-job-manager.js";
import { ApiGatewayManager } from "./platform/api-gateway-manager.js";
import { ExternalServiceManager } from "./platform/external-service-manager.js";
import { SearchIndexManager } from "./platform/search-index-manager.js";
import { LlmManager } from "./platform/llm-manager.js";
import { OpenAiResponsesProvider } from "./platform/openai-responses-provider.js";
import { MockWorkbenchProvider } from "./platform/mock-workbench-provider.js";

function shouldEnableMockWorkbenchProvider(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV === "test" ||
    env.FORGE_ENABLE_DEV_MOCKS === "1" ||
    env.FORGE_OPENCLAW_DEV === "1"
  );
}

export function createManagerRuntime(options: { dataRoot?: string } = {}) {
  const configuration = new ConfigurationManager();
  const runtimeConfig = configuration.readRuntimeConfig({ dataRoot: options.dataRoot });
  const database = new DatabaseManager();
  database.configure(runtimeConfig.dataRoot);

  const secrets = new SecretsManager();
  secrets.configure(runtimeConfig.dataRoot ?? process.cwd());
  const transaction = new TransactionManager();
  const migration = new MigrationManager();
  const storage = new StorageManager();
  const audit = new AuditManager();
  const session = new SessionManager(database, secrets, configuration, audit);
  const token = new TokenManager(audit);
  const authentication = new AuthenticationManager(session, token);
  const authorization = new AuthorizationManager();
  const eventBus = new EventBusManager();
  const health = new HealthManager();
  const backgroundJobs = new BackgroundJobManager();
  const apiGateway = new ApiGatewayManager();
  const externalServices = new ExternalServiceManager();
  const searchIndex = new SearchIndexManager();
  const llm = new LlmManager(secrets);
  llm.register(new OpenAiResponsesProvider());
  if (shouldEnableMockWorkbenchProvider()) {
    llm.register(new MockWorkbenchProvider());
  }

  return {
    configuration,
    secrets,
    database,
    transaction,
    migration,
    storage,
    authentication,
    authorization,
    session,
    token,
    eventBus,
    audit,
    health,
    backgroundJobs,
    apiGateway,
    externalServices,
    searchIndex,
    llm
  };
}
