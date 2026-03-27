export class AbstractManager {
}
export class AbstractAuthAwareManager extends AbstractManager {
    getNow(context) {
        return context.now ?? new Date();
    }
}
export class AbstractAuditedManager extends AbstractAuthAwareManager {
}
export class AbstractVersionedManager extends AbstractAuditedManager {
}
export class AbstractReadModelManager extends AbstractAuthAwareManager {
}
export class AbstractExternalManager extends AbstractManager {
}
export class AbstractWritableManager extends AbstractAuditedManager {
}
