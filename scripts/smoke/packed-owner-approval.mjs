import { spawn } from "node:child_process";

const MAXIMUM_PROCESS_DIAGNOSTIC_CHARACTERS = 2_048;

function createBoundedProcessDiagnostic() {
  let value = "";
  let truncated = false;
  return {
    append(chunk) {
      const printable = String(chunk).replace(/[^\x20-\x7E]/g, "?");
      const remaining = MAXIMUM_PROCESS_DIAGNOSTIC_CHARACTERS - value.length;
      if (remaining > 0) {
        value += printable.slice(0, remaining);
      }
      if (printable.length > remaining) {
        truncated = true;
      }
    },
    suffix() {
      const bounded = value.trim();
      return bounded ? `: ${bounded}${truncated ? "…" : ""}` : "";
    }
  };
}

export async function runPackedOwnerApproval(
  binaryPath,
  socketPath,
  request,
  timeoutMs
) {
  await new Promise((resolve, reject) => {
    const helper = spawn(binaryPath, ["approve", "--socket", socketPath], {
      stdio: ["pipe", "ignore", "pipe"],
      env: {}
    });
    const diagnostic = createBoundedProcessDiagnostic();
    let settled = false;
    const failure = (message, cause) =>
      new Error(`${message}${diagnostic.suffix()}`, { cause });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      helper.kill("SIGTERM");
      finish(failure("packed owner-broker helper timed out"));
    }, timeoutMs);
    timeout.unref();
    helper.stderr.setEncoding("utf8");
    helper.stderr.on("data", (chunk) => {
      diagnostic.append(chunk);
    });
    helper.once("error", (error) => finish(failure(error.message, error)));
    helper.once("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(
        failure(
          `packed owner-broker helper failed (${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`})`
        )
      );
    });
    helper.stdin.end(JSON.stringify(request));
  });
}
