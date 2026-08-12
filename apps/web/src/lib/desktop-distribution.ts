export type DesktopUpdateStatus =
  | { kind: "web" }
  | { kind: "current"; currentVersion: string }
  | { kind: "available"; currentVersion: string; version: string; date: string | null; notes: string | null }
  | { kind: "unconfigured"; currentVersion: string; message: string };

function isTauriDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateStatus> {
  if (!isTauriDesktop()) return { kind: "web" };
  const [{ getVersion }, { check }] = await Promise.all([
    import("@tauri-apps/api/app"),
    import("@tauri-apps/plugin-updater")
  ]);
  const currentVersion = await getVersion();
  try {
    const update = await check({ timeout: 30_000 });
    if (!update) return { kind: "current", currentVersion };
    const status: DesktopUpdateStatus = {
      kind: "available",
      currentVersion,
      version: update.version,
      date: update.date ?? null,
      notes: update.body ?? null
    };
    await update.close();
    return status;
  } catch (error) {
    return {
      kind: "unconfigured",
      currentVersion,
      message: error instanceof Error ? error.message : "This build does not have a signed update channel."
    };
  }
}

export async function installDesktopUpdate(
  expectedVersion: string,
  onProgress: (downloaded: number, total: number | null) => void
) {
  if (!isTauriDesktop()) throw new Error("Signed updates are available only inside Forge Desktop.");
  const [{ check }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/plugin-process")
  ]);
  const update = await check({ timeout: 30_000 });
  if (!update || update.version !== expectedVersion) {
    await update?.close();
    throw new Error("The available update changed. Check again before installing.");
  }
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? null;
    if (event.event === "Progress") downloaded += event.data.chunkLength;
    onProgress(downloaded, total);
  });
  await update.close();
  await relaunch();
}
