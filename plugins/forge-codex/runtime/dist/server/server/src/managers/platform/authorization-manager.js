import { AbstractManager } from "../base.js";
import { AuthRequiredError, InsufficientScopeError } from "../contracts.js";
export class AuthorizationManager extends AbstractManager {
    name = "AuthorizationManager";
    requireAuthenticatedOperator(context, detail) {
        if (context.session) {
            return;
        }
        throw new AuthRequiredError("An authenticated operator session is required.", detail);
    }
    requireAuthenticatedActor(context, detail) {
        if (context.session || context.token) {
            return;
        }
        throw new AuthRequiredError("Authentication is required for this operation.", detail);
    }
    requireTokenScope(context, scope, detail) {
        if (context.session) {
            return;
        }
        if (!context.token) {
            throw new AuthRequiredError("A token or operator session is required.", {
                requiredScope: scope,
                ...(detail ?? {})
            });
        }
        if (!context.token.scopes.includes(scope)) {
            throw new InsufficientScopeError(`This operation requires the ${scope} scope.`, {
                requiredScope: scope,
                scopes: context.token.scopes,
                ...(detail ?? {})
            });
        }
    }
    requireAnyTokenScope(context, scopes, detail) {
        if (context.session) {
            return;
        }
        if (!context.token) {
            throw new AuthRequiredError("A token or operator session is required.", {
                requiredScopes: scopes,
                ...(detail ?? {})
            });
        }
        if (!scopes.some((scope) => context.token?.scopes.includes(scope))) {
            throw new InsufficientScopeError(`This operation requires one of: ${scopes.join(", ")}.`, {
                requiredScopes: scopes,
                scopes: context.token.scopes,
                ...(detail ?? {})
            });
        }
    }
    canManageOperator(context) {
        return Boolean(context.session);
    }
}
