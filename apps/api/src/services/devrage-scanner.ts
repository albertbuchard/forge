import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);

type BetterSqliteConstructor = new (
  filename: string,
  options: { readonly: true }
) => {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
};

export type MessageRole =
  | "assistant"
  | "user"
  | "developer"
  | "system"
  | "unknown";

export type DevrageSource =
  | "amp"
  | "claude"
  | "cline"
  | "codex"
  | "hermes"
  | "openclaw"
  | "opencode"
  | "zed"
  | "unknown";

export interface ConversationMessage {
  agent: string;
  source: DevrageSource;
  conversationId: string;
  role: MessageRole;
  text: string;
  timestamp?: string;
  sourceFile: string;
}

export interface ConversationRecord {
  source: DevrageSource;
  conversationId: string;
  project?: string;
  sourceFile: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export interface ReaderWarning {
  file: string;
  line: number;
  reason: string;
}

export interface SourceStats {
  source: DevrageSource;
  conversations: number;
  messages: number;
  messagesWithSwears: number;
  swears: number;
}

export interface ConversationStats {
  source: DevrageSource;
  conversationId: string;
  sourceFile: string;
  project?: string;
  updatedAt: string;
  dateKey: string;
  messages: number;
  messagesWithSwears: number;
  swears: number;
  maxCumulativeRage: number;
  maxSwearingStreak: number;
}

export interface DailyStats {
  dateKey: string;
  conversations: number;
  messages: number;
  messagesWithSwears: number;
  swears: number;
  swearingMessagePercent: number;
  averageMaxCumulativeRage: number;
  maxCumulativeRage: number;
  maxSwearingStreak: number;
}

export interface WordStats {
  root: string;
  count: number;
  variants: Record<string, number>;
}

export interface ActualWordStats {
  word: string;
  root: string;
  count: number;
}

export interface DevrageReport {
  generatedAt: string;
  filesScanned: string[];
  conversationsScanned: number;
  messagesScanned: number;
  messagesWithSwears: number;
  totalSwears: number;
  averageMaxCumulativeRage: number;
  maxCumulativeRage: number;
  maxSwearingStreak: number;
  byAgent: Array<{
    agent: string;
    messages: number;
    messagesWithSwears: number;
    swears: number;
  }>;
  bySource: SourceStats[];
  conversations: ConversationStats[];
  daily: DailyStats[];
  topWords: WordStats[];
  actualWords: ActualWordStats[];
  warnings: ReaderWarning[];
  roleFilter: MessageRole[];
  sourceFilter: DevrageSource[];
  dateFilter: {
    date?: string;
    since?: string;
    until?: string;
  };
  scanStatus?: "complete" | "partial";
  failedSources?: DevrageSource[];
}

export interface ScanOptions {
  roles: Set<MessageRole>;
  sources?: Set<DevrageSource>;
  date?: string;
  since?: Date;
  until?: Date;
  timeZone?: string;
  signal?: AbortSignal;
  maxFileBytes?: number;
  maxRecordChars?: number;
  maxScanBytes?: number;
}

interface AdapterReadResult {
  conversations: ConversationRecord[];
  warnings: ReaderWarning[];
}

interface Adapter {
  source: DevrageSource;
  read(options: AdapterReadOptions): Promise<AdapterReadResult>;
}

interface AdapterReadOptions {
  signal?: AbortSignal;
  maxFileBytes: number;
  maxRecordChars: number;
  maxScanBytes: number;
  scannedBytes: number;
}

interface SwearEntry {
  root: string;
  variants: string[];
}

interface PhraseVariant {
  root: string;
  variant: string;
  pattern: RegExp;
}

type UnknownRecord = Record<string, unknown>;

const tokenPattern = /[a-z][a-z0-9'*_-]*/gi;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_RECORD_CHARS = 512 * 1024;
const DEFAULT_MAX_SCAN_BYTES = 32 * 1024 * 1024;
const READ_STREAM_CHUNK_BYTES = 64 * 1024;

const defaultSwearLexicon: SwearEntry[] = [
  {
    root: "fuck",
    variants: [
      "fuck",
      "f*ck",
      "f**k",
      "fck",
      "fuk",
      "fucked",
      "fucker",
      "fuckers",
      "fuckin",
      "fucking",
      "fucks",
      "motherfuck",
      "motherfucked",
      "motherfucker",
      "motherfuckers",
      "motherfucking"
    ]
  },
  {
    root: "ffs",
    variants: [
      "ffs",
      "for fucks sake",
      "for fuck's sake",
      "for-fucks-sake",
      "for-fuck's-sake"
    ]
  },
  { root: "wtf", variants: ["wtf"] },
  {
    root: "shit",
    variants: [
      "shit",
      "shitshow",
      "shits",
      "shitty",
      "bullshit",
      "bullshitting",
      "dipshit",
      "dipshits"
    ]
  },
  { root: "dick", variants: ["dick", "dicks", "dickhead", "dickheads"] },
  {
    root: "ass",
    variants: [
      "ass",
      "asses",
      "asshole",
      "assholes",
      "ashole",
      "asholes",
      "dumbass",
      "dumbasses",
      "dumb ass",
      "dumb asses",
      "dumb-ass",
      "dumb-asses",
      "jackass",
      "jackasses",
      "jack ass",
      "jack asses",
      "jack-ass",
      "jack-asses"
    ]
  },
  {
    root: "damn",
    variants: ["damn", "damned", "dammit", "goddamn", "goddamned"]
  },
  { root: "bitch", variants: ["bitch", "bitches", "bitching"] },
  { root: "hell", variants: ["hell"] },
  {
    root: "crap",
    variants: ["crap", "crappy", "piece of crap", "piece-of-crap"]
  },
  { root: "moron", variants: ["moron", "morons", "morno", "mornos"] },
  { root: "idiot", variants: ["idiot", "idiots"] },
  { root: "stupid", variants: ["stupid"] },
  { root: "dumb", variants: ["dumb"] },
  { root: "garbage", variants: ["garbage"] },
  { root: "trash", variants: ["trash"] },
  { root: "suck", variants: ["suck", "sucks", "sucked", "sucking"] }
];

const ADAPTER_FACTORIES: Record<string, () => Adapter> = {
  amp: () =>
    jsonThreadAdapter("amp", [join(dataHome(), "amp", "threads", "*.json")]),
  claude: claudeAdapter,
  cline: clineAdapter,
  codex: codexAdapter,
  hermes: () =>
    genericLocalLogAdapter("hermes", [
      join(homedir(), ".hermes", "**/*.{json,jsonl}"),
      join(homedir(), ".config", "hermes", "**/*.{json,jsonl}")
    ]),
  openclaw: openclawAdapter,
  opencode: opencodeAdapter,
  zed: zedAdapter
};

export async function scanConversations(
  options: ScanOptions
): Promise<DevrageReport> {
  const adapters = options.sources?.size
    ? [...options.sources].map((source) => createAdapter(source))
    : allAdapters();
  const conversations: ConversationRecord[] = [];
  const warnings: ReaderWarning[] = [];
  const failedSources = new Set<DevrageSource>();
  const readOptions: AdapterReadOptions = {
    signal: options.signal,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxRecordChars: options.maxRecordChars ?? DEFAULT_MAX_RECORD_CHARS,
    maxScanBytes: options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES,
    scannedBytes: 0
  };

  for (const adapter of adapters) {
    if (options.signal?.aborted) {
      failedSources.add(adapter.source);
      warnings.push(scanCancelledWarning(adapter.source, options.signal));
      break;
    }
    try {
      const result = await adapter.read(readOptions);
      conversations.push(...result.conversations);
      warnings.push(...result.warnings);
      if (result.warnings.length > 0) {
        failedSources.add(adapter.source);
      }
    } catch (error) {
      failedSources.add(adapter.source);
      warnings.push({
        file: adapter.source,
        line: 0,
        reason: options.signal?.aborted
          ? scanCancelledWarning(adapter.source, options.signal).reason
          : `${adapter.source} adapter failed: ${errorMessage(error)}`
      });
      if (options.signal?.aborted) {
        break;
      }
    }
  }

  const report = analyzeConversations(conversations, options);
  report.warnings = warnings;
  report.sourceFilter = adapters.map((adapter) => adapter.source).sort();
  report.scanStatus = warnings.length > 0 ? "partial" : "complete";
  report.failedSources = [...failedSources].sort();
  return report;
}

export function availableSources(): DevrageSource[] {
  return Object.keys(ADAPTER_FACTORIES).sort() as DevrageSource[];
}

function createAdapter(source: string): Adapter {
  const factory = ADAPTER_FACTORIES[source.toLowerCase()];
  if (!factory) {
    throw new Error(
      `unknown source: ${source} (available: ${availableSources().join(", ")})`
    );
  }
  return factory();
}

function allAdapters(): Adapter[] {
  return availableSources().map((source) => createAdapter(source));
}

export function analyzeConversations(
  conversations: ConversationRecord[],
  options: ScanOptions,
  generatedAt = new Date().toISOString()
): DevrageReport {
  const { tokenIndex, phraseVariants } = buildLexiconIndexes();
  const agentStats = new Map<
    string,
    { messages: number; messagesWithSwears: number; swears: number }
  >();
  const sourceStats = new Map<string, SourceStats>();
  const wordStats = new Map<string, WordStats>();
  const actualWordStats = new Map<string, ActualWordStats>();
  const filesScanned = new Set<string>();
  const conversationStats: ConversationStats[] = [];
  const conversationMaxCumulativeRages: number[] = [];
  const conversationMaxSwearingStreaks: number[] = [];
  let conversationsScanned = 0;
  let messagesScanned = 0;
  let messagesWithSwears = 0;
  let totalSwears = 0;

  for (const conversation of conversations) {
    const selectedMessages = conversation.messages
      .flatMap((message, index) => {
        if (!options.roles.has(message.role)) {
          return [];
        }
        const timestamp = normalizedMessageTimestamp(message, conversation);
        if (
          !timestamp ||
          !isTimestampInDateRange(timestamp.value, timestamp.time, options)
        ) {
          return [];
        }
        return [
          {
            message,
            index,
            ...timestamp,
            dateKey: dayKey(timestamp.value, options.timeZone)
          }
        ];
      })
      .sort(
        (left, right) => left.time - right.time || left.index - right.index
      );

    if (selectedMessages.length === 0) {
      continue;
    }

    conversationsScanned += 1;
    filesScanned.add(conversation.sourceFile);
    let cumulativeRage = 0;
    let maxCumulativeRage = 0;
    let swearingStreak = 0;
    let maxSwearingStreak = 0;
    const dailyStats = new Map<
      string,
      ConversationStats & { cumulativeRage: number; swearingStreak: number }
    >();

    const currentSource = sourceStats.get(conversation.source) ?? {
      source: conversation.source,
      conversations: 0,
      messages: 0,
      messagesWithSwears: 0,
      swears: 0
    };
    currentSource.conversations += 1;

    for (const selected of selectedMessages) {
      const { message } = selected;
      const currentDay = dailyStats.get(selected.dateKey) ?? {
        source: conversation.source,
        conversationId: conversation.conversationId,
        project: conversation.project,
        sourceFile: conversation.sourceFile,
        updatedAt: selected.value,
        dateKey: selected.dateKey,
        messages: 0,
        messagesWithSwears: 0,
        swears: 0,
        maxCumulativeRage: 0,
        maxSwearingStreak: 0,
        cumulativeRage: 0,
        swearingStreak: 0
      };
      if (selected.time > Date.parse(currentDay.updatedAt)) {
        currentDay.updatedAt = selected.value;
      }

      messagesScanned += 1;
      currentDay.messages += 1;
      currentSource.messages += 1;

      const agent = normalizeAgent(message.agent);
      const currentAgent = agentStats.get(agent) ?? {
        messages: 0,
        messagesWithSwears: 0,
        swears: 0
      };
      currentAgent.messages += 1;

      let swearsInMessage = 0;
      for (const occurrence of findOccurrences(
        message.text,
        tokenIndex,
        phraseVariants
      )) {
        swearsInMessage += 1;
        totalSwears += 1;
        currentDay.swears += 1;
        currentSource.swears += 1;
        addOccurrence(wordStats, actualWordStats, occurrence);
      }

      if (swearsInMessage > 0) {
        messagesWithSwears += 1;
        currentDay.messagesWithSwears += 1;
        currentSource.messagesWithSwears += 1;
        currentAgent.messagesWithSwears += 1;
        currentAgent.swears += swearsInMessage;
        cumulativeRage += swearsInMessage;
        swearingStreak += 1;
        currentDay.cumulativeRage += swearsInMessage;
        currentDay.swearingStreak += 1;
      } else {
        cumulativeRage = Math.max(0, cumulativeRage - 1);
        swearingStreak = 0;
        currentDay.cumulativeRage = Math.max(0, currentDay.cumulativeRage - 1);
        currentDay.swearingStreak = 0;
      }

      maxCumulativeRage = Math.max(maxCumulativeRage, cumulativeRage);
      maxSwearingStreak = Math.max(maxSwearingStreak, swearingStreak);
      currentDay.maxCumulativeRage = Math.max(
        currentDay.maxCumulativeRage,
        currentDay.cumulativeRage
      );
      currentDay.maxSwearingStreak = Math.max(
        currentDay.maxSwearingStreak,
        currentDay.swearingStreak
      );
      agentStats.set(agent, currentAgent);
      dailyStats.set(selected.dateKey, currentDay);
    }

    sourceStats.set(conversation.source, currentSource);
    conversationMaxCumulativeRages.push(maxCumulativeRage);
    conversationMaxSwearingStreaks.push(maxSwearingStreak);
    conversationStats.push(
      ...[...dailyStats.values()].map(
        ({ cumulativeRage: _rage, swearingStreak: _streak, ...stats }) => stats
      )
    );
  }
  const maxCumulativeRage = Math.max(0, ...conversationMaxCumulativeRages);
  const maxSwearingStreak = Math.max(0, ...conversationMaxSwearingStreaks);
  const averageMaxCumulativeRage =
    conversationMaxCumulativeRages.length === 0
      ? 0
      : conversationMaxCumulativeRages.reduce((sum, value) => sum + value, 0) /
        conversationMaxCumulativeRages.length;

  return {
    generatedAt,
    filesScanned: [...filesScanned].sort(),
    conversationsScanned,
    messagesScanned,
    messagesWithSwears,
    totalSwears,
    averageMaxCumulativeRage,
    maxCumulativeRage,
    maxSwearingStreak,
    byAgent: [...agentStats.entries()]
      .map(([agent, stats]) => ({ agent, ...stats }))
      .sort(
        (left, right) =>
          right.swears - left.swears ||
          right.messages - left.messages ||
          left.agent.localeCompare(right.agent)
      ),
    bySource: [...sourceStats.values()].sort(
      (left, right) =>
        right.swears - left.swears ||
        right.messages - left.messages ||
        left.source.localeCompare(right.source)
    ),
    conversations: conversationStats.sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        left.source.localeCompare(right.source) ||
        left.conversationId.localeCompare(right.conversationId)
    ),
    daily: buildDailyStats(conversationStats),
    topWords: [...wordStats.values()].sort(
      (left, right) =>
        right.count - left.count || left.root.localeCompare(right.root)
    ),
    actualWords: [...actualWordStats.values()].sort(
      (left, right) =>
        right.count - left.count ||
        left.word.localeCompare(right.word) ||
        left.root.localeCompare(right.root)
    ),
    warnings: [],
    roleFilter: [...options.roles].sort(),
    sourceFilter: [],
    dateFilter: {
      date: options.date,
      since: options.since?.toISOString(),
      until: options.until?.toISOString()
    },
    scanStatus: "complete",
    failedSources: []
  };
}

function codexAdapter(): Adapter {
  return {
    source: "codex",
    async read(options) {
      return readJsonlTree(
        "codex",
        [
          join(homedir(), ".codex", "sessions"),
          join(homedir(), ".codex", "archived_sessions")
        ],
        parseCodexLine,
        options
      );
    }
  };
}

function claudeAdapter(): Adapter {
  return {
    source: "claude",
    async read(options) {
      return readJsonlTree(
        "claude",
        [join(homedir(), ".claude", "projects")],
        parseClaudeLine,
        options
      );
    }
  };
}

function clineAdapter(): Adapter {
  return {
    source: "cline",
    async read(options) {
      const roots = getVSCodeGlobalStoragePaths()
        .flatMap((basePath) => [
          join(basePath, "saoudrizwan.claude-dev", "tasks"),
          join(basePath, "rooveterinaryinc.roo-cline", "tasks")
        ])
        .concat(join(homedir(), ".cline", "data", "tasks"));
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const root of roots) {
        if (!existsSync(root)) {
          continue;
        }
        const files = await globFiles(
          `${root.replace(/\/+$/, "")}/**/api_conversation_history.json`,
          { signal: options.signal }
        );
        for (const filePath of files) {
          const sizeWarning = boundedFileWarning(filePath, options);
          if (sizeWarning) {
            warnings.push(sizeWarning);
            continue;
          }
          throwIfAborted(options.signal);
          try {
            const raw = await readFile(filePath, "utf8");
            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
              continue;
            }
            const messages = parsed.flatMap((entry, index) =>
              compactMessage(
                parseGenericMessage(entry, {
                  source: "cline",
                  conversationId: basename(
                    filePath.replace(/\/api_conversation_history\.json$/, "")
                  ),
                  sourceFile: filePath,
                  fallbackTimestamp: fileTimestamp(filePath),
                  index
                })
              )
            );
            pushConversation(conversations, "cline", filePath, messages);
          } catch {
            warnings.push({
              file: filePath,
              line: 0,
              reason: "Malformed Cline conversation skipped."
            });
          }
        }
      }

      return { conversations, warnings };
    }
  };
}

function opencodeAdapter(): Adapter {
  return {
    source: "opencode",
    async read(options) {
      const dbPath = findFirstExisting([
        join(dataHome(), "opencode", "opencode.db"),
        join(
          homedir(),
          "Library",
          "Application Support",
          "opencode",
          "opencode.db"
        )
      ]);
      if (!dbPath) {
        return { conversations: [], warnings: [] };
      }
      const sizeWarning = boundedFileWarning(dbPath, options);
      if (sizeWarning) {
        return { conversations: [], warnings: [sizeWarning] };
      }
      throwIfAborted(options.signal);

      const Database = loadBetterSqlite();
      if (!Database) {
        return {
          conversations: [],
          warnings: [
            {
              file: dbPath,
              line: 0,
              reason: "better-sqlite3 unavailable; OpenCode database skipped."
            }
          ]
        };
      }

      const bySession = new Map<string, ConversationMessage[]>();
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db
          .prepare(
            `SELECT m.session_id AS sessionId,
                    m.time_created AS timeCreated,
                    json_extract(m.data, '$.role') AS role,
                    json_extract(p.data, '$.text') AS text
             FROM message m
             JOIN part p ON p.message_id = m.id
             WHERE json_extract(p.data, '$.type') = 'text'
             ORDER BY m.time_created ASC`
          )
          .all() as Array<{
          sessionId: string;
          timeCreated: number;
          role: string;
          text: string | null;
        }>;

        for (const row of rows) {
          throwIfAborted(options.signal);
          const text = typeof row.text === "string" ? row.text.trim() : "";
          const role = normalizeRole(row.role);
          if (!text || isContextInjection(role, text)) {
            continue;
          }
          if (text.length > options.maxRecordChars) {
            return {
              conversations: [],
              warnings: [boundedRecordWarning(dbPath, 0, options.maxRecordChars)]
            };
          }
          const conversationId = String(row.sessionId || "unknown");
          const message: ConversationMessage = {
            agent: "opencode",
            source: "opencode",
            conversationId,
            role,
            text,
            timestamp: new Date(row.timeCreated).toISOString(),
            sourceFile: dbPath
          };
          const messages = bySession.get(conversationId) ?? [];
          messages.push(message);
          bySession.set(conversationId, messages);
        }
      } finally {
        db.close();
      }

      return {
        conversations: [...bySession.entries()].map(
          ([conversationId, messages]) => ({
            source: "opencode",
            conversationId,
            sourceFile: dbPath,
            updatedAt: maxTimestamp(messages) ?? fileTimestamp(dbPath),
            messages
          })
        ),
        warnings: []
      };
    }
  };
}

function zedAdapter(): Adapter {
  return {
    source: "zed",
    async read(options) {
      const base =
        process.platform === "darwin"
          ? join(homedir(), "Library", "Application Support", "Zed")
          : join(dataHome(), "zed");
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];
      const jsonFiles = await globFiles(join(base, "conversations", "*.json"), {
        signal: options.signal
      });

      for (const filePath of jsonFiles) {
        const sizeWarning = boundedFileWarning(filePath, options);
        if (sizeWarning) {
          warnings.push(sizeWarning);
          continue;
        }
        throwIfAborted(options.signal);
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as UnknownRecord;
          const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
          const messages = entries.flatMap((entry, index) =>
            compactMessage(
              parseGenericMessage(entry, {
                source: "zed",
                conversationId: basename(filePath, ".json"),
                sourceFile: filePath,
                fallbackTimestamp: fileTimestamp(filePath),
                index
              })
            )
          );
          pushConversation(conversations, "zed", filePath, messages);
        } catch {
          warnings.push({
            file: filePath,
            line: 0,
            reason: "Malformed Zed conversation skipped."
          });
        }
      }

      return { conversations, warnings };
    }
  };
}

function jsonThreadAdapter(source: DevrageSource, patterns: string[]): Adapter {
  return {
    source,
    async read(options) {
      const files = await globFiles(patterns, { signal: options.signal });
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const filePath of files) {
        const sizeWarning = boundedFileWarning(filePath, options);
        if (sizeWarning) {
          warnings.push(sizeWarning);
          continue;
        }
        throwIfAborted(options.signal);
        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as UnknownRecord;
          const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
          const messages = entries.flatMap((entry, index) =>
            compactMessage(
              parseGenericMessage(entry, {
                source,
                conversationId: basename(filePath, ".json"),
                sourceFile: filePath,
                fallbackTimestamp: fileTimestamp(filePath),
                index
              })
            )
          );
          pushConversation(conversations, source, filePath, messages);
        } catch {
          warnings.push({
            file: filePath,
            line: 0,
            reason: `Malformed ${source} conversation skipped.`
          });
        }
      }

      return { conversations, warnings };
    }
  };
}

function genericLocalLogAdapter(
  source: DevrageSource,
  patterns: string[]
): Adapter {
  return {
    source,
    async read(options) {
      const candidateFiles = await globFiles(patterns, {
        ignore: ["node_modules", ".git", "venv", "__pycache__"],
        signal: options.signal
      });
      const files = candidateFiles.filter((file) =>
        /conversation|history|session|thread|transcript/i.test(file)
      );
      const conversations: ConversationRecord[] = [];
      const warnings: ReaderWarning[] = [];

      for (const filePath of files) {
        throwIfAborted(options.signal);
        if (filePath.endsWith(".jsonl")) {
          const result = await readJsonlFile(
            source,
            filePath,
            parseGenericJsonLine,
            options
          );
          conversations.push(...result.conversations);
          warnings.push(...result.warnings);
          continue;
        }

        const sizeWarning = boundedFileWarning(filePath, options);
        if (sizeWarning) {
          warnings.push(sizeWarning);
          continue;
        }

        try {
          const raw = await readFile(filePath, "utf8");
          const parsed = JSON.parse(raw) as unknown;
          const entries = extractMessageArray(parsed);
          const messages = entries.flatMap((entry, index) =>
            compactMessage(
              parseGenericMessage(entry, {
                source,
                conversationId: basename(filePath).replace(/\.[^.]+$/, ""),
                sourceFile: filePath,
                fallbackTimestamp: fileTimestamp(filePath),
                index
              })
            )
          );
          pushConversation(conversations, source, filePath, messages);
        } catch {
          warnings.push({
            file: filePath,
            line: 0,
            reason: `Malformed ${source} log skipped.`
          });
        }
      }

      return { conversations, warnings };
    }
  };
}

function openclawAdapter(): Adapter {
  return {
    source: "openclaw",
    async read(options) {
      const trajectoryResult = await readJsonlTree(
        "openclaw",
        [
          join(homedir(), ".openclaw", "agents"),
          join(
            homedir(),
            "Library",
            "Application Support",
            "OpenClaw",
            "agents"
          )
        ],
        parseOpenClawTrajectoryLine,
        options
      );
      const genericResult = await genericLocalLogAdapter("openclaw", [
        join(homedir(), ".openclaw", "**/*.{json,jsonl}"),
        join(
          homedir(),
          "Library",
          "Application Support",
          "OpenClaw",
          "**/*.{json,jsonl}"
        )
      ]).read(options);
      return {
        conversations: [
          ...trajectoryResult.conversations,
          ...genericResult.conversations.filter(
            (conversation) =>
              !conversation.sourceFile.endsWith(".trajectory.jsonl")
          )
        ],
        warnings: [...trajectoryResult.warnings, ...genericResult.warnings]
      };
    }
  };
}

async function readJsonlTree(
  source: DevrageSource,
  roots: string[],
  parser: JsonlParser,
  options: AdapterReadOptions
): Promise<AdapterReadResult> {
  const files = (
    await Promise.all(
      roots.map((root) =>
        globFiles(`${root.replace(/\/+$/, "")}/**/*.jsonl`, {
          signal: options.signal
        })
      )
    )
  )
    .flat()
    .sort();

  const conversations: ConversationRecord[] = [];
  const warnings: ReaderWarning[] = [];
  for (const filePath of files) {
    throwIfAborted(options.signal);
    const result = await readJsonlFile(source, filePath, parser, options);
    conversations.push(...result.conversations);
    warnings.push(...result.warnings);
  }
  return { conversations, warnings };
}

type JsonlParser = (
  record: unknown,
  context: {
    source: DevrageSource;
    conversationId: string;
    sourceFile: string;
    fallbackTimestamp: string;
    line: number;
  }
) => ConversationMessage | null;

async function readJsonlFile(
  source: DevrageSource,
  filePath: string,
  parser: JsonlParser,
  options: AdapterReadOptions
): Promise<AdapterReadResult> {
  const sizeWarning = boundedFileWarning(filePath, options);
  if (sizeWarning) {
    return { conversations: [], warnings: [sizeWarning] };
  }

  const messages: ConversationMessage[] = [];
  const warnings: ReaderWarning[] = [];
  const fallbackTimestamp = fileTimestamp(filePath);
  const conversationId = basename(filePath, ".jsonl");
  for await (const record of readBoundedJsonlLines(filePath, options)) {
    if (record.text === null) {
      warnings.push(
        boundedRecordWarning(filePath, record.lineNumber, options.maxRecordChars)
      );
      continue;
    }
    const line = record.text;
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const message = parser(parsed, {
        source,
        conversationId,
        sourceFile: filePath,
        fallbackTimestamp,
        line: record.lineNumber
      });
      if (message) {
        messages.push(message);
      }
    } catch {
      warnings.push({
        file: filePath,
        line: record.lineNumber,
        reason: "Invalid JSONL record skipped."
      });
    }
  }

  return {
    conversations:
      messages.length === 0
        ? []
        : [
            {
              source,
              conversationId,
              sourceFile: filePath,
              updatedAt: maxTimestamp(messages) ?? fallbackTimestamp,
              messages
            }
          ],
    warnings
  };
}

async function* readBoundedJsonlLines(
  filePath: string,
  options: AdapterReadOptions
): AsyncGenerator<{ lineNumber: number; text: string | null }> {
  const input = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: READ_STREAM_CHUNK_BYTES,
    signal: options.signal
  });
  let buffer = "";
  let discarding = false;
  let lineNumber = 0;

  try {
    for await (const value of input) {
      throwIfAborted(options.signal);
      const chunk = String(value);
      let start = 0;

      while (start < chunk.length) {
        const newline = chunk.indexOf("\n", start);
        const end = newline < 0 ? chunk.length : newline;
        if (!discarding) {
          const part = chunk.slice(start, end);
          if (buffer.length + part.length > options.maxRecordChars) {
            buffer = "";
            discarding = true;
          } else {
            buffer += part;
          }
        }

        if (newline < 0) {
          break;
        }

        lineNumber += 1;
        yield {
          lineNumber,
          text: discarding ? null : buffer.replace(/\r$/, "")
        };
        buffer = "";
        discarding = false;
        start = newline + 1;
      }
    }

    if (buffer.length > 0 || discarding) {
      lineNumber += 1;
      yield { lineNumber, text: discarding ? null : buffer.replace(/\r$/, "") };
    }
  } finally {
    input.destroy();
  }
}

function parseCodexLine(
  record: unknown,
  context: Parameters<JsonlParser>[1]
): ConversationMessage | null {
  if (
    !isObject(record) ||
    record.type !== "response_item" ||
    !isObject(record.payload)
  ) {
    return null;
  }
  const payload = record.payload;
  if (payload.type !== "message") {
    return null;
  }
  const role = normalizeRole(payload.role);
  const text = extractText(payload.content).join("\n").trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }
  return {
    agent: "codex",
    source: "codex",
    conversationId: context.conversationId,
    role,
    text,
    timestamp:
      typeof record.timestamp === "string" ? record.timestamp : undefined,
    sourceFile: context.sourceFile
  };
}

function parseClaudeLine(
  record: unknown,
  context: Parameters<JsonlParser>[1]
): ConversationMessage | null {
  if (!isObject(record)) {
    return null;
  }
  const role = normalizeRole(record.role ?? record.type);
  const message = isObject(record.message) ? record.message : record;
  const text = extractText(message.content ?? record.content)
    .join("\n")
    .trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }
  return {
    agent: "claude",
    source: "claude",
    conversationId: context.conversationId,
    role,
    text,
    timestamp:
      typeof record.timestamp === "string"
        ? record.timestamp
        : typeof record.createdAt === "string"
          ? record.createdAt
          : undefined,
    sourceFile: context.sourceFile
  };
}

function parseGenericJsonLine(
  record: unknown,
  context: Parameters<JsonlParser>[1]
): ConversationMessage | null {
  return parseGenericMessage(record, {
    source: context.source,
    conversationId: context.conversationId,
    sourceFile: context.sourceFile,
    fallbackTimestamp: context.fallbackTimestamp,
    index: context.line
  });
}

export function parseOpenClawTrajectoryLine(
  record: unknown,
  context: Parameters<JsonlParser>[1]
): ConversationMessage | null {
  if (
    !isObject(record) ||
    record.type !== "prompt.submitted" ||
    !isObject(record.data)
  ) {
    return null;
  }

  const data = record.data;
  const text =
    typeof data.prompt === "string" && data.prompt.trim().length > 0
      ? data.prompt.trim()
      : latestOpenClawUserMessageText(data.messages);
  if (!text || isContextInjection("user", text)) {
    return null;
  }

  return {
    agent: "openclaw",
    source: "openclaw",
    conversationId: context.conversationId.replace(/\.trajectory$/, ""),
    role: "user",
    text,
    timestamp:
      stringTimestamp(record.ts) ??
      stringTimestamp(record.timestamp) ??
      stringTimestamp(data.timestamp) ??
      numberTimestamp(record.ts) ??
      context.fallbackTimestamp,
    sourceFile: context.sourceFile
  };
}

function latestOpenClawUserMessageText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !isObject(message) ||
      normalizeRole(message.role ?? message.type) !== "user"
    ) {
      continue;
    }
    const text = extractText(message.content ?? message.text)
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function parseGenericMessage(
  entry: unknown,
  context: {
    source: DevrageSource;
    conversationId: string;
    sourceFile: string;
    fallbackTimestamp: string;
    index: number;
  }
): ConversationMessage | null {
  if (!isObject(entry)) {
    return null;
  }
  const message = isObject(entry.message) ? entry.message : entry;
  const role = normalizeRole(message.role ?? entry.role ?? entry.type);
  const text = extractText(
    message.content ?? entry.content ?? message.text ?? entry.text
  )
    .join("\n")
    .trim();
  if (!text || isContextInjection(role, text)) {
    return null;
  }
  const timestamp =
    stringTimestamp(entry.timestamp) ??
    stringTimestamp(entry.createdAt) ??
    stringTimestamp(message.timestamp) ??
    numberTimestamp(entry.ts) ??
    numberTimestamp(message.ts) ??
    context.fallbackTimestamp;
  return {
    agent: context.source,
    source: context.source,
    conversationId: context.conversationId,
    role,
    text,
    timestamp,
    sourceFile: context.sourceFile
  };
}

function normalizeRole(role: unknown): MessageRole {
  if (
    role === "assistant" ||
    role === "user" ||
    role === "developer" ||
    role === "system"
  ) {
    return role;
  }
  return "unknown";
}

function isContextInjection(role: MessageRole, text: string): boolean {
  if (role !== "user") {
    return false;
  }
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    (trimmed.includes("<environment_context>") &&
      trimmed.includes("<INSTRUCTIONS>"))
  );
}

function extractText(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (Array.isArray(content)) {
    return content.flatMap((item) => extractText(item));
  }
  if (!isObject(content)) {
    return [];
  }
  const direct = content.text ?? content.value;
  if (typeof direct === "string") {
    return [direct];
  }
  if (content.content !== undefined) {
    return extractText(content.content);
  }
  return [];
}

function buildLexiconIndexes(lexicon = defaultSwearLexicon): {
  tokenIndex: Map<string, string>;
  phraseVariants: PhraseVariant[];
} {
  const tokenIndex = new Map<string, string>();
  const phraseVariants: PhraseVariant[] = [];
  for (const entry of lexicon) {
    for (const variant of entry.variants) {
      const normalizedVariant = variant.toLowerCase();
      if (/[\s-]/.test(normalizedVariant)) {
        phraseVariants.push({
          root: entry.root,
          variant: normalizedVariant,
          pattern: buildPhrasePattern(normalizedVariant)
        });
        continue;
      }
      tokenIndex.set(normalizeToken(normalizedVariant), entry.root);
    }
  }
  phraseVariants.sort(
    (left, right) =>
      right.variant.length - left.variant.length ||
      left.variant.localeCompare(right.variant)
  );
  return { tokenIndex, phraseVariants };
}

function buildPhrasePattern(variant: string): RegExp {
  const words = variant.split(/[\s-]+/).map(escapeRegExp);
  return new RegExp(`\\b${words.join("[\\s-]*")}\\b`, "gi");
}

function findOccurrences(
  text: string,
  tokenIndex: Map<string, string>,
  phraseVariants: PhraseVariant[]
): Array<{ root: string; variant: string; actual: string }> {
  const occurrences: Array<{ root: string; variant: string; actual: string }> =
    [];
  const phraseRanges: Array<{ start: number; end: number }> = [];

  for (const phrase of phraseVariants) {
    phrase.pattern.lastIndex = 0;
    for (const match of text.matchAll(phrase.pattern)) {
      const matchedText = match[0];
      const start = match.index ?? 0;
      const end = start + matchedText.length;
      if (
        !/[\s-]/.test(matchedText) &&
        tokenIndex.has(normalizeToken(matchedText))
      ) {
        continue;
      }
      if (overlapsAny({ start, end }, phraseRanges)) {
        continue;
      }
      phraseRanges.push({ start, end });
      occurrences.push({
        root: phrase.root,
        variant: phrase.variant,
        actual: matchedText.toLowerCase().replace(/\s+/g, " ").trim()
      });
    }
  }

  for (const match of tokenizeWithSpans(text)) {
    if (overlapsAny(match, phraseRanges)) {
      continue;
    }
    const root = tokenIndex.get(match.token);
    if (root) {
      occurrences.push({ root, variant: match.token, actual: match.token });
    }
  }
  return occurrences;
}

function tokenizeWithSpans(
  text: string
): Array<{ token: string; start: number; end: number }> {
  const matches: Array<{ token: string; start: number; end: number }> = [];
  tokenPattern.lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const rawToken = match[0];
    const token = normalizeToken(rawToken);
    if (!token) {
      continue;
    }
    const start = match.index ?? 0;
    matches.push({ token, start, end: start + rawToken.length });
  }
  return matches;
}

function addOccurrence(
  wordStats: Map<string, WordStats>,
  actualWordStats: Map<string, ActualWordStats>,
  occurrence: { root: string; variant: string; actual: string }
): void {
  const currentWord = wordStats.get(occurrence.root) ?? {
    root: occurrence.root,
    count: 0,
    variants: {}
  };
  currentWord.count += 1;
  currentWord.variants[occurrence.variant] =
    (currentWord.variants[occurrence.variant] ?? 0) + 1;
  wordStats.set(occurrence.root, currentWord);

  const actualKey = `${occurrence.root}\u0000${occurrence.actual}`;
  const currentActual = actualWordStats.get(actualKey) ?? {
    word: occurrence.actual,
    root: occurrence.root,
    count: 0
  };
  currentActual.count += 1;
  actualWordStats.set(actualKey, currentActual);
}

function buildDailyStats(conversations: ConversationStats[]): DailyStats[] {
  const byDay = new Map<
    string,
    DailyStats & { maxCumulativeRageSum: number }
  >();
  for (const conversation of conversations) {
    const current = byDay.get(conversation.dateKey) ?? {
      dateKey: conversation.dateKey,
      conversations: 0,
      messages: 0,
      messagesWithSwears: 0,
      swears: 0,
      swearingMessagePercent: 0,
      averageMaxCumulativeRage: 0,
      maxCumulativeRage: 0,
      maxSwearingStreak: 0,
      maxCumulativeRageSum: 0
    };
    current.conversations += 1;
    current.messages += conversation.messages;
    current.messagesWithSwears += conversation.messagesWithSwears;
    current.swears += conversation.swears;
    current.maxCumulativeRageSum += conversation.maxCumulativeRage;
    current.maxCumulativeRage = Math.max(
      current.maxCumulativeRage,
      conversation.maxCumulativeRage
    );
    current.maxSwearingStreak = Math.max(
      current.maxSwearingStreak,
      conversation.maxSwearingStreak
    );
    current.swearingMessagePercent =
      current.messages === 0
        ? 0
        : (current.messagesWithSwears / current.messages) * 100;
    current.averageMaxCumulativeRage =
      current.conversations === 0
        ? 0
        : current.maxCumulativeRageSum / current.conversations;
    byDay.set(conversation.dateKey, current);
  }
  return [...byDay.values()]
    .map((stats) => ({
      dateKey: stats.dateKey,
      conversations: stats.conversations,
      messages: stats.messages,
      messagesWithSwears: stats.messagesWithSwears,
      swears: stats.swears,
      swearingMessagePercent: stats.swearingMessagePercent,
      averageMaxCumulativeRage: stats.averageMaxCumulativeRage,
      maxCumulativeRage: stats.maxCumulativeRage,
      maxSwearingStreak: stats.maxSwearingStreak
    }))
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

function compactMessage(
  message: ConversationMessage | null
): ConversationMessage[] {
  return message ? [message] : [];
}

function extractMessageArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isObject(value)) {
    return [];
  }
  for (const key of ["messages", "conversation", "turns", "items", "history"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function pushConversation(
  conversations: ConversationRecord[],
  source: DevrageSource,
  filePath: string,
  messages: ConversationMessage[]
): void {
  if (messages.length === 0) {
    return;
  }
  conversations.push({
    source,
    conversationId:
      messages[0]?.conversationId ?? basename(filePath).replace(/\.[^.]+$/, ""),
    sourceFile: filePath,
    updatedAt: maxTimestamp(messages) ?? fileTimestamp(filePath),
    messages
  });
}

function dayKey(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  if (!timeZone) {
    return date.toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day
    ? `${year}-${month}-${day}`
    : date.toISOString().slice(0, 10);
}

function isTimestampInDateRange(
  value: string,
  timestamp: number,
  options: ScanOptions
): boolean {
  if (options.date && dayKey(value, options.timeZone) !== options.date) {
    return false;
  }
  if (options.since && timestamp < options.since.getTime()) {
    return false;
  }
  if (options.until && timestamp >= options.until.getTime()) {
    return false;
  }
  return true;
}

function normalizedMessageTimestamp(
  message: ConversationMessage,
  conversation: ConversationRecord
): { value: string; time: number } | null {
  for (const candidate of [message.timestamp, conversation.updatedAt]) {
    if (!candidate) {
      continue;
    }
    const time = Date.parse(candidate);
    if (Number.isFinite(time)) {
      return { value: new Date(time).toISOString(), time };
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

function scanCancelledWarning(
  source: DevrageSource,
  signal: AbortSignal
): ReaderWarning {
  return {
    file: source,
    line: 0,
    reason: `Scan cancelled before completion: ${errorMessage(signal.reason ?? "aborted")}`
  };
}

function boundedFileWarning(
  filePath: string,
  options: AdapterReadOptions
): ReaderWarning | null {
  try {
    const fileBytes = statSync(filePath).size;
    if (fileBytes > options.maxFileBytes) {
      return {
        file: filePath,
        line: 0,
        reason: `File is ${fileBytes} bytes and exceeds the ${options.maxFileBytes}-byte scan limit; file skipped.`
      };
    }
    if (options.scannedBytes + fileBytes > options.maxScanBytes) {
      return {
        file: filePath,
        line: 0,
        reason: `Reading this file would exceed the ${options.maxScanBytes}-byte total scan limit; file skipped.`
      };
    }
    options.scannedBytes += fileBytes;
    return null;
  } catch {
    return null;
  }
}

function boundedRecordWarning(
  filePath: string,
  lineNumber: number,
  maxRecordChars: number
): ReaderWarning {
  return {
    file: filePath,
    line: lineNumber,
    reason: `Record exceeds the ${maxRecordChars}-character scan limit; record skipped.`
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Devrage scan aborted.");
}

function maxTimestamp(messages: ConversationMessage[]): string | null {
  let max = Number.NEGATIVE_INFINITY;
  let value: string | null = null;
  for (const message of messages) {
    if (!message.timestamp) {
      continue;
    }
    const timestamp = Date.parse(message.timestamp);
    if (Number.isFinite(timestamp) && timestamp > max) {
      max = timestamp;
      value = new Date(timestamp).toISOString();
    }
  }
  return value;
}

function fileTimestamp(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function dataHome(): string {
  return process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
}

function getVSCodeGlobalStoragePaths(): string[] {
  if (process.platform === "darwin") {
    return [
      join(
        homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "globalStorage"
      ),
      join(
        homedir(),
        "Library",
        "Application Support",
        "Code - Insiders",
        "User",
        "globalStorage"
      ),
      join(
        homedir(),
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage"
      )
    ];
  }
  if (process.platform === "linux") {
    const configBase =
      process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
    return [
      join(configBase, "Code", "User", "globalStorage"),
      join(configBase, "Code - Insiders", "User", "globalStorage"),
      join(configBase, "Cursor", "User", "globalStorage")
    ];
  }
  const appData =
    process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
  return [
    join(appData, "Code", "User", "globalStorage"),
    join(appData, "Code - Insiders", "User", "globalStorage")
  ];
}

function findFirstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

async function globFiles(
  patterns: string | string[],
  options: { ignore?: string[]; signal?: AbortSignal } = {}
): Promise<string[]> {
  const results = new Set<string>();
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    throwIfAborted(options.signal);
    const normalizedPattern = normalizePath(pattern);
    const root = globRoot(pattern);
    if (!root || !existsSync(root)) {
      continue;
    }
    const matcher = globPatternToRegExp(normalizedPattern);
    for await (const filePath of walkFiles(
      root,
      options.ignore ?? [],
      options.signal
    )) {
      if (matcher.test(normalizePath(filePath))) {
        results.add(filePath);
      }
    }
  }
  return [...results].sort();
}

async function* walkFiles(
  root: string,
  ignoredNames: string[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  throwIfAborted(signal);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    throwIfAborted(signal);
    if (ignoredNames.includes(entry.name)) {
      continue;
    }
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath, ignoredNames, signal);
      continue;
    }
    if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function globRoot(pattern: string): string | null {
  const firstGlob = pattern.search(/[*{]/);
  if (firstGlob < 0) {
    return statIsFile(pattern) ? pattern : pathDirectory(pattern);
  }
  const prefix = pattern.slice(0, firstGlob).replace(/[\\/]+$/, "");
  return prefix ? resolve(prefix) : resolve(sep);
}

function pathDirectory(value: string): string | null {
  const trimmed = value.replace(/[\\/]+$/, "");
  return resolve(dirname(trimmed || "."));
}

function globPatternToRegExp(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      const after = pattern[index + 2];
      if (after === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      expression += "[^/]*";
      continue;
    }
    if (char === "{") {
      const close = pattern.indexOf("}", index + 1);
      if (close > index) {
        const alternatives = pattern
          .slice(index + 1, close)
          .split(",")
          .map(escapeRegExp)
          .join("|");
        expression += `(?:${alternatives})`;
        index = close;
        continue;
      }
    }
    expression += escapeRegExp(char);
  }
  return new RegExp(`^${expression}$`);
}

function normalizePath(value: string): string {
  return resolve(value).split(sep).join("/");
}

function statIsFile(value: string): boolean {
  try {
    return statSync(value).isFile();
  } catch {
    return false;
  }
}

function loadBetterSqlite(): BetterSqliteConstructor | null {
  try {
    const candidate: unknown = require("better-sqlite3");
    return typeof candidate === "function"
      ? (candidate as BetterSqliteConstructor)
      : null;
  } catch {
    return null;
  }
}

function stringTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function numberTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replaceAll("*", "")
    .replaceAll("_", "")
    .replaceAll("-", "")
    .replace(/^'+|'+$/g, "");
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase() || "unknown";
}

function overlapsAny(
  range: { start: number; end: number },
  ranges: Array<{ start: number; end: number }>
): boolean {
  return ranges.some(
    (other) => range.start < other.end && range.end > other.start
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
