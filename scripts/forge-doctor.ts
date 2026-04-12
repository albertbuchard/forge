import { resolveForgePluginConfig } from "../src/openclaw/plugin-entry-shared.ts";
import { runDoctor } from "../src/openclaw/routes.ts";

type RawCliConfig = Partial<{
  origin: string;
  port: number;
  dataRoot: string;
  apiToken: string;
  actorLabel: string;
  timeoutMs: number;
}>;

function readOptionValue(
  argv: string[],
  index: number,
  flag: string,
  inlineValue: string | undefined
) {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: index };
  }
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return { value: next, nextIndex: index + 1 };
}

function readIntegerOption(flag: string, raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} must be a number.`);
  }
  return Math.round(value);
}

function parseCliConfig(argv: string[]) {
  const config: RawCliConfig = {};
  let showHelp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const [flag, inlineValue] = arg.split("=", 2);
    const { value, nextIndex } = readOptionValue(
      argv,
      index,
      flag,
      inlineValue
    );
    index = nextIndex;

    switch (flag) {
      case "--origin":
        config.origin = value;
        break;
      case "--port":
        config.port = readIntegerOption(flag, value);
        break;
      case "--data-root":
        config.dataRoot = value;
        break;
      case "--api-token":
        config.apiToken = value;
        break;
      case "--actor-label":
        config.actorLabel = value;
        break;
      case "--timeout-ms":
        config.timeoutMs = readIntegerOption(flag, value);
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return { config, showHelp };
}

function printHelp() {
  console.log(`Forge doctor

Usage:
  npm run doctor -- [options]
  node --import tsx scripts/forge-doctor.ts [options]

Options:
  --origin <url>         Forge origin without the port. Default: $FORGE_ORIGIN or http://127.0.0.1
  --port <number>        Forge server port. Default: $FORGE_PORT or 4317
  --data-root <path>     Optional Forge data root.
  --api-token <token>    Optional bearer token for remote targets.
  --actor-label <label>  Optional actor label for diagnostics.
  --timeout-ms <ms>      Request timeout in milliseconds.
  --help                 Show this message.
`);
}

async function main() {
  const { config: cliConfig, showHelp } = parseCliConfig(process.argv.slice(2));
  if (showHelp) {
    printHelp();
    return;
  }

  const config = resolveForgePluginConfig({
    origin: cliConfig.origin ?? process.env.FORGE_ORIGIN,
    port:
      cliConfig.port ??
      (process.env.FORGE_PORT ? Number(process.env.FORGE_PORT) : undefined),
    dataRoot: cliConfig.dataRoot ?? process.env.FORGE_DATA_ROOT,
    apiToken: cliConfig.apiToken ?? process.env.FORGE_API_TOKEN,
    actorLabel: cliConfig.actorLabel ?? process.env.FORGE_ACTOR_LABEL,
    timeoutMs:
      cliConfig.timeoutMs ??
      (process.env.FORGE_TIMEOUT_MS
        ? Number(process.env.FORGE_TIMEOUT_MS)
        : undefined)
  });

  const doctor = await runDoctor(config);
  console.log(JSON.stringify(doctor, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
