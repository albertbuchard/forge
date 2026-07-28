export function pairingRequiresBrowserStepUp(request) {
  return (
    ["executor", "operator", "custom"].includes(request.requestedProfile) ||
    request.requestedScopes.some(
      (scope) =>
        scope === "*" ||
        scope.startsWith("machine.") ||
        scope.startsWith("secret.") ||
        scope.startsWith("admin.")
    )
  );
}

export async function executePairingDecision({
  selected,
  decision,
  promptCode,
  callApi,
  openAgents,
  agentsUrl
}) {
  const normalizedDecision = decision.trim().toLowerCase();
  if (normalizedDecision === "cancel" || normalizedDecision === "c") {
    return { status: "cancelled" };
  }
  if (normalizedDecision === "deny" || normalizedDecision === "d") {
    const denied = await callApi({
      method: "POST",
      path: `/api/v1/auth/device/requests/${encodeURIComponent(selected.requestId)}/deny`,
      body: {}
    });
    if (denied.status >= 400) {
      throw new Error(
        `Forge could not deny the selected request (HTTP ${denied.status}). Refresh the list and try again.`
      );
    }
    return { status: "denied" };
  }
  if (normalizedDecision !== "approve" && normalizedDecision !== "a") {
    throw new Error("Choose approve, deny, or cancel.");
  }
  if (pairingRequiresBrowserStepUp(selected)) {
    await openAgents(agentsUrl);
    return { status: "opened_step_up" };
  }
  const userCode = (await promptCode()).trim().toUpperCase();
  if (userCode.length < 8) {
    throw new Error("Enter the complete short pairing code.");
  }
  const approved = await callApi({
    method: "POST",
    path: `/api/v1/auth/device/requests/${encodeURIComponent(selected.requestId)}/approve`,
    body: { userCode }
  });
  if (approved.status >= 400) {
    throw new Error(
      `Forge could not approve the selected request (HTTP ${approved.status}). Confirm the code still matches this device and try again.`
    );
  }
  return { status: "approved" };
}
