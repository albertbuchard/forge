import type { ForgePrincipal } from "./contracts.js";

export function canUseDevWebUpgrade(
  principal: ForgePrincipal | null | undefined
): principal is ForgePrincipal {
  if (principal?.kind === "operator_session") {
    return true;
  }
  return (
    principal?.kind === "paired_client" &&
    principal.clientType === "browser" &&
    principal.profile === "operator"
  );
}
