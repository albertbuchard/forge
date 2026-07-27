import { AbstractManager } from "../base.js";
import {
  AuthRequiredError,
  InsufficientScopeError,
  type AuthContext
} from "../contracts.js";

export class AuthorizationManager extends AbstractManager {
  readonly name = "AuthorizationManager";

  requireAuthenticatedOperator(
    context: AuthContext,
    detail?: Record<string, unknown>
  ) {
    if (context.session) {
      return;
    }
    throw new AuthRequiredError(
      "An authenticated operator session is required.",
      detail
    );
  }

  requireAuthenticatedActor(
    context: AuthContext,
    detail?: Record<string, unknown>
  ) {
    if (context.session || context.token) {
      return;
    }
    throw new AuthRequiredError(
      "Authentication is required for this operation.",
      detail
    );
  }

  requireTokenScope(
    context: AuthContext,
    scope: string,
    detail?: Record<string, unknown>
  ) {
    if (context.session) {
      return;
    }
    if (!context.token) {
      throw new AuthRequiredError("A token or operator session is required.", {
        requiredScope: scope,
        ...(detail ?? {})
      });
    }
    if (
      !context.token.scopes.includes("*") &&
      !context.token.scopes.includes(scope)
    ) {
      throw new InsufficientScopeError(
        `This operation requires the ${scope} scope.`,
        {
          requiredScope: scope,
          scopes: context.token.scopes,
          ...(detail ?? {})
        }
      );
    }
  }

  requireAnyTokenScope(
    context: AuthContext,
    scopes: string[],
    detail?: Record<string, unknown>
  ) {
    if (context.session) {
      return;
    }
    if (!context.token) {
      throw new AuthRequiredError("A token or operator session is required.", {
        requiredScopes: scopes,
        ...(detail ?? {})
      });
    }
    if (
      !context.token.scopes.includes("*") &&
      !scopes.some((scope) => context.token?.scopes.includes(scope))
    ) {
      throw new InsufficientScopeError(
        `This operation requires one of: ${scopes.join(", ")}.`,
        {
          requiredScopes: scopes,
          scopes: context.token.scopes,
          ...(detail ?? {})
        }
      );
    }
  }

  requireAllTokenScopes(
    context: AuthContext,
    scopes: string[],
    detail?: Record<string, unknown>
  ) {
    if (context.session) {
      return;
    }
    if (!context.token) {
      throw new AuthRequiredError("A token or operator session is required.", {
        requiredScopes: scopes,
        ...(detail ?? {})
      });
    }
    const missingScopes = context.token.scopes.includes("*")
      ? []
      : scopes.filter((scope) => !context.token?.scopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new InsufficientScopeError(
        `This operation requires all of: ${scopes.join(", ")}.`,
        {
          requiredScopes: scopes,
          missingScopes,
          scopes: context.token.scopes,
          ...(detail ?? {})
        }
      );
    }
  }

  canManageOperator(context: AuthContext) {
    return Boolean(context.session);
  }
}
