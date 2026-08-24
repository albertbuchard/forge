const VITE_PRELOAD_RECOVERY_KEY = "forge:vite-preload-recovery-at";
const VITE_PRELOAD_RECOVERY_COOLDOWN_MS = 60_000;

export function installVitePreloadRecovery(
  target: Window = window,
  now: () => number = Date.now
) {
  const recover = (event: Event) => {
    const attemptedAt = now();
    let previousAttempt = 0;
    try {
      previousAttempt = Number(
        target.sessionStorage.getItem(VITE_PRELOAD_RECOVERY_KEY) ?? "0"
      );
      if (
        Number.isFinite(previousAttempt) &&
        previousAttempt > 0 &&
        attemptedAt - previousAttempt < VITE_PRELOAD_RECOVERY_COOLDOWN_MS
      ) {
        return;
      }
      target.sessionStorage.setItem(
        VITE_PRELOAD_RECOVERY_KEY,
        String(attemptedAt)
      );
    } catch {
      // Without durable page-scoped state, automatic reload could loop.
      return;
    }

    event.preventDefault();
    target.location.reload();
  };

  target.addEventListener("vite:preloadError", recover);
  return () => target.removeEventListener("vite:preloadError", recover);
}
