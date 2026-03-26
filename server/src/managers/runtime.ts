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

export function createManagerRuntime(options: { dataRoot?: string } = {}) {
  const configuration = new ConfigurationManager();
  const database = new DatabaseManager();
  database.configure(configuration.readRuntimeConfig({ dataRoot: options.dataRoot }).dataRoot);

  const secrets = new SecretsManager();
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
    searchIndex
  };
}
