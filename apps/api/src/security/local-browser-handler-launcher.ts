import { execFile } from "node:child_process";
import path from "node:path";

const LOCAL_BROWSER_HANDLER_LAUNCH_TIMEOUT_MS = 4_000;
const LOCAL_BROWSER_HANDLER_MAX_OUTPUT_BYTES = 8 * 1024;

export type LocalBrowserHandlerCommand = (
  command: string,
  args: string[]
) => Promise<void>;

export type LocalBrowserHandlerLauncher = (
  handlerUrl: string
) => Promise<void>;

function runLocalBrowserHandlerCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: LOCAL_BROWSER_HANDLER_MAX_OUTPUT_BYTES,
        timeout: LOCAL_BROWSER_HANDLER_LAUNCH_TIMEOUT_MS,
        windowsHide: true
      },
      (error) => {
        if (error) {
          reject(
            new Error("Forge could not open its verified local owner app.", {
              cause: error
            })
          );
          return;
        }
        resolve();
      }
    );
  });
}

function isForgeLocalBrowserHandlerUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "forge:" &&
      parsed.hostname === "local-auth" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function createMacosLocalBrowserHandlerLauncher(input: {
  appPath: string | null;
  platform?: NodeJS.Platform;
  runCommand?: LocalBrowserHandlerCommand;
}): LocalBrowserHandlerLauncher | null {
  const platform = input.platform ?? process.platform;
  if (
    platform !== "darwin" ||
    !input.appPath ||
    !path.isAbsolute(input.appPath) ||
    path.extname(input.appPath).toLowerCase() !== ".app"
  ) {
    return null;
  }
  const runCommand = input.runCommand ?? runLocalBrowserHandlerCommand;
  return async (handlerUrl) => {
    if (!isForgeLocalBrowserHandlerUrl(handlerUrl)) {
      throw new Error("Forge refused an invalid local owner handler URL.");
    }
    await runCommand("/usr/bin/open", ["-a", input.appPath!, handlerUrl]);
  };
}
