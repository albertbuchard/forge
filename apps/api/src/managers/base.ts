import type { AuthContext, ExternalBackedManager, ReadableManager, SubsystemManager, VersionedManager, WritableManager } from "./contracts.js";

export abstract class AbstractManager implements SubsystemManager {
  abstract readonly name: string;
}

export abstract class AbstractAuthAwareManager extends AbstractManager {
  protected getNow(context: Pick<AuthContext, "now">) {
    return context.now ?? new Date();
  }
}

export abstract class AbstractAuditedManager extends AbstractAuthAwareManager {}

export abstract class AbstractVersionedManager<TRecord, TPatch>
  extends AbstractAuditedManager
  implements VersionedManager<TRecord, TPatch>
{
  abstract create(input: TRecord, context: AuthContext): Promise<TRecord> | TRecord;
  abstract update(id: string, patch: TPatch, context: AuthContext): Promise<TRecord | null> | TRecord | null;
}

export abstract class AbstractReadModelManager<TQuery, TResult>
  extends AbstractAuthAwareManager
  implements ReadableManager<TQuery, TResult>
{
  abstract read(query: TQuery, context: AuthContext): Promise<TResult> | TResult;
}

export abstract class AbstractExternalManager<TProviderConfig>
  extends AbstractManager
  implements ExternalBackedManager<TProviderConfig>
{
  abstract configure(config: TProviderConfig): Promise<void> | void;
}

export abstract class AbstractWritableManager<TInput, TResult>
  extends AbstractAuditedManager
  implements WritableManager<TInput, TResult>
{
  abstract write(input: TInput, context: AuthContext): Promise<TResult> | TResult;
}
