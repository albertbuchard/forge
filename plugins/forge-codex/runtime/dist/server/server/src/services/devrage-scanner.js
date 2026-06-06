import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
const require = createRequire(import.meta.url);
const tokenPattern = /[a-z][a-z0-9'*_-]*/gi;
const defaultSwearLexicon = [
    { root: "fuck", variants: ["fuck", "fucked", "fucker", "fuckers", "fuckin", "fucking", "fucks", "motherfuck", "motherfucked", "motherfucker", "motherfuckers", "motherfucking"] },
    { root: "wtf", variants: ["wtf"] },
    { root: "shit", variants: ["shit", "shitshow", "shits", "shitty", "bullshit", "bullshitting", "dipshit", "dipshits"] },
    { root: "dick", variants: ["dick", "dicks", "dickhead", "dickheads"] },
    { root: "ass", variants: ["ass", "asses", "asshole", "assholes", "ashole", "asholes", "dumbass", "dumbasses", "dumb ass", "dumb asses", "dumb-ass", "dumb-asses", "jackass", "jackasses", "jack ass", "jack asses", "jack-ass", "jack-asses"] },
    { root: "damn", variants: ["damn", "damned", "dammit", "goddamn", "goddamned"] },
    { root: "bitch", variants: ["bitch", "bitches", "bitching"] },
    { root: "hell", variants: ["hell"] },
    { root: "crap", variants: ["crap", "crappy", "piece of crap", "piece-of-crap"] },
    { root: "moron", variants: ["moron", "morons", "morno", "mornos"] },
    { root: "idiot", variants: ["idiot", "idiots"] },
    { root: "stupid", variants: ["stupid"] },
    { root: "dumb", variants: ["dumb"] },
    { root: "garbage", variants: ["garbage"] },
    { root: "trash", variants: ["trash"] },
    { root: "suck", variants: ["suck", "sucks", "sucked", "sucking"] }
];
const ADAPTER_FACTORIES = {
    amp: () => jsonThreadAdapter("amp", [join(dataHome(), "amp", "threads", "*.json")]),
    claude: claudeAdapter,
    cline: clineAdapter,
    codex: codexAdapter,
    hermes: () => genericLocalLogAdapter("hermes", [
        join(homedir(), ".hermes", "**/*.{json,jsonl}"),
        join(homedir(), ".config", "hermes", "**/*.{json,jsonl}")
    ]),
    openclaw: () => genericLocalLogAdapter("openclaw", [
        join(homedir(), ".openclaw", "**/*.{json,jsonl}"),
        join(homedir(), "Library", "Application Support", "OpenClaw", "**/*.{json,jsonl}")
    ]),
    opencode: opencodeAdapter,
    zed: zedAdapter
};
export async function scanConversations(options) {
    const adapters = options.sources?.size
        ? [...options.sources].map((source) => createAdapter(source))
        : allAdapters();
    const conversations = [];
    const warnings = [];
    for (const adapter of adapters) {
        const result = await adapter.read();
        conversations.push(...result.conversations);
        warnings.push(...result.warnings);
    }
    const report = analyzeConversations(conversations, options);
    report.warnings = warnings;
    report.sourceFilter = adapters.map((adapter) => adapter.source).sort();
    return report;
}
export function availableSources() {
    return Object.keys(ADAPTER_FACTORIES).sort();
}
function createAdapter(source) {
    const factory = ADAPTER_FACTORIES[source.toLowerCase()];
    if (!factory) {
        throw new Error(`unknown source: ${source} (available: ${availableSources().join(", ")})`);
    }
    return factory();
}
function allAdapters() {
    return availableSources().map((source) => createAdapter(source));
}
function analyzeConversations(conversations, options, generatedAt = new Date().toISOString()) {
    const { tokenIndex, phraseVariants } = buildLexiconIndexes();
    const agentStats = new Map();
    const sourceStats = new Map();
    const wordStats = new Map();
    const actualWordStats = new Map();
    const filesScanned = new Set();
    const conversationStats = [];
    let messagesScanned = 0;
    let messagesWithSwears = 0;
    let totalSwears = 0;
    for (const conversation of conversations) {
        if (!isConversationInDateRange(conversation, options)) {
            continue;
        }
        filesScanned.add(conversation.sourceFile);
        const dateKey = dayKey(conversation.updatedAt, options.timeZone);
        let conversationMessages = 0;
        let conversationMessagesWithSwears = 0;
        let conversationSwears = 0;
        const currentSource = sourceStats.get(conversation.source) ?? {
            source: conversation.source,
            conversations: 0,
            messages: 0,
            messagesWithSwears: 0,
            swears: 0
        };
        currentSource.conversations += 1;
        for (const message of conversation.messages) {
            if (!options.roles.has(message.role)) {
                continue;
            }
            messagesScanned += 1;
            conversationMessages += 1;
            currentSource.messages += 1;
            const agent = normalizeAgent(message.agent);
            const currentAgent = agentStats.get(agent) ?? {
                messages: 0,
                messagesWithSwears: 0,
                swears: 0
            };
            currentAgent.messages += 1;
            let swearsInMessage = 0;
            for (const occurrence of findOccurrences(message.text, tokenIndex, phraseVariants)) {
                swearsInMessage += 1;
                totalSwears += 1;
                conversationSwears += 1;
                currentSource.swears += 1;
                addOccurrence(wordStats, actualWordStats, occurrence);
            }
            if (swearsInMessage > 0) {
                messagesWithSwears += 1;
                conversationMessagesWithSwears += 1;
                currentSource.messagesWithSwears += 1;
                currentAgent.messagesWithSwears += 1;
                currentAgent.swears += swearsInMessage;
            }
            agentStats.set(agent, currentAgent);
        }
        sourceStats.set(conversation.source, currentSource);
        conversationStats.push({
            source: conversation.source,
            conversationId: conversation.conversationId,
            project: conversation.project,
            sourceFile: conversation.sourceFile,
            updatedAt: conversation.updatedAt,
            dateKey,
            messages: conversationMessages,
            messagesWithSwears: conversationMessagesWithSwears,
            swears: conversationSwears
        });
    }
    return {
        generatedAt,
        filesScanned: [...filesScanned].sort(),
        conversationsScanned: conversationStats.length,
        messagesScanned,
        messagesWithSwears,
        totalSwears,
        byAgent: [...agentStats.entries()]
            .map(([agent, stats]) => ({ agent, ...stats }))
            .sort((left, right) => right.swears - left.swears ||
            right.messages - left.messages ||
            left.agent.localeCompare(right.agent)),
        bySource: [...sourceStats.values()].sort((left, right) => right.swears - left.swears ||
            right.messages - left.messages ||
            left.source.localeCompare(right.source)),
        conversations: conversationStats.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
            left.source.localeCompare(right.source) ||
            left.conversationId.localeCompare(right.conversationId)),
        daily: buildDailyStats(conversationStats),
        topWords: [...wordStats.values()].sort((left, right) => right.count - left.count || left.root.localeCompare(right.root)),
        actualWords: [...actualWordStats.values()].sort((left, right) => right.count - left.count ||
            left.word.localeCompare(right.word) ||
            left.root.localeCompare(right.root)),
        warnings: [],
        roleFilter: [...options.roles].sort(),
        sourceFilter: [],
        dateFilter: {
            date: options.date,
            since: options.since?.toISOString(),
            until: options.until?.toISOString()
        }
    };
}
function codexAdapter() {
    return {
        source: "codex",
        async read() {
            return readJsonlTree("codex", [join(homedir(), ".codex", "sessions"), join(homedir(), ".codex", "archived_sessions")], parseCodexLine);
        }
    };
}
function claudeAdapter() {
    return {
        source: "claude",
        async read() {
            return readJsonlTree("claude", [join(homedir(), ".claude", "projects")], parseClaudeLine);
        }
    };
}
function clineAdapter() {
    return {
        source: "cline",
        async read() {
            const roots = getVSCodeGlobalStoragePaths()
                .flatMap((basePath) => [
                join(basePath, "saoudrizwan.claude-dev", "tasks"),
                join(basePath, "rooveterinaryinc.roo-cline", "tasks")
            ])
                .concat(join(homedir(), ".cline", "data", "tasks"));
            const conversations = [];
            const warnings = [];
            for (const root of roots) {
                if (!existsSync(root)) {
                    continue;
                }
                const files = await globFiles(`${root.replace(/\/+$/, "")}/**/api_conversation_history.json`);
                for (const filePath of files) {
                    try {
                        const raw = await readFile(filePath, "utf8");
                        const parsed = JSON.parse(raw);
                        if (!Array.isArray(parsed)) {
                            continue;
                        }
                        const messages = parsed.flatMap((entry, index) => compactMessage(parseGenericMessage(entry, {
                            source: "cline",
                            conversationId: basename(filePath.replace(/\/api_conversation_history\.json$/, "")),
                            sourceFile: filePath,
                            fallbackTimestamp: fileTimestamp(filePath),
                            index
                        })));
                        pushConversation(conversations, "cline", filePath, messages);
                    }
                    catch {
                        warnings.push({ file: filePath, line: 0, reason: "Malformed Cline conversation skipped." });
                    }
                }
            }
            return { conversations, warnings };
        }
    };
}
function opencodeAdapter() {
    return {
        source: "opencode",
        async read() {
            const dbPath = findFirstExisting([
                join(dataHome(), "opencode", "opencode.db"),
                join(homedir(), "Library", "Application Support", "opencode", "opencode.db")
            ]);
            if (!dbPath) {
                return { conversations: [], warnings: [] };
            }
            const Database = loadBetterSqlite();
            if (!Database) {
                return {
                    conversations: [],
                    warnings: [{ file: dbPath, line: 0, reason: "better-sqlite3 unavailable; OpenCode database skipped." }]
                };
            }
            const bySession = new Map();
            const db = new Database(dbPath, { readonly: true });
            try {
                const rows = db
                    .prepare(`SELECT m.session_id AS sessionId,
                    m.time_created AS timeCreated,
                    json_extract(m.data, '$.role') AS role,
                    json_extract(p.data, '$.text') AS text
             FROM message m
             JOIN part p ON p.message_id = m.id
             WHERE json_extract(p.data, '$.type') = 'text'
             ORDER BY m.time_created ASC`)
                    .all();
                for (const row of rows) {
                    const text = typeof row.text === "string" ? row.text.trim() : "";
                    const role = normalizeRole(row.role);
                    if (!text || isContextInjection(role, text)) {
                        continue;
                    }
                    const conversationId = String(row.sessionId || "unknown");
                    const message = {
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
            }
            finally {
                db.close();
            }
            return {
                conversations: [...bySession.entries()].map(([conversationId, messages]) => ({
                    source: "opencode",
                    conversationId,
                    sourceFile: dbPath,
                    updatedAt: maxTimestamp(messages) ?? fileTimestamp(dbPath),
                    messages
                })),
                warnings: []
            };
        }
    };
}
function zedAdapter() {
    return {
        source: "zed",
        async read() {
            const base = process.platform === "darwin"
                ? join(homedir(), "Library", "Application Support", "Zed")
                : join(dataHome(), "zed");
            const conversations = [];
            const warnings = [];
            const jsonFiles = await globFiles(join(base, "conversations", "*.json"));
            for (const filePath of jsonFiles) {
                try {
                    const raw = await readFile(filePath, "utf8");
                    const parsed = JSON.parse(raw);
                    const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
                    const messages = entries.flatMap((entry, index) => compactMessage(parseGenericMessage(entry, {
                        source: "zed",
                        conversationId: basename(filePath, ".json"),
                        sourceFile: filePath,
                        fallbackTimestamp: fileTimestamp(filePath),
                        index
                    })));
                    pushConversation(conversations, "zed", filePath, messages);
                }
                catch {
                    warnings.push({ file: filePath, line: 0, reason: "Malformed Zed conversation skipped." });
                }
            }
            return { conversations, warnings };
        }
    };
}
function jsonThreadAdapter(source, patterns) {
    return {
        source,
        async read() {
            const files = await globFiles(patterns);
            const conversations = [];
            const warnings = [];
            for (const filePath of files) {
                try {
                    const raw = await readFile(filePath, "utf8");
                    const parsed = JSON.parse(raw);
                    const entries = Array.isArray(parsed.messages) ? parsed.messages : [];
                    const messages = entries.flatMap((entry, index) => compactMessage(parseGenericMessage(entry, {
                        source,
                        conversationId: basename(filePath, ".json"),
                        sourceFile: filePath,
                        fallbackTimestamp: fileTimestamp(filePath),
                        index
                    })));
                    pushConversation(conversations, source, filePath, messages);
                }
                catch {
                    warnings.push({ file: filePath, line: 0, reason: `Malformed ${source} conversation skipped.` });
                }
            }
            return { conversations, warnings };
        }
    };
}
function genericLocalLogAdapter(source, patterns) {
    return {
        source,
        async read() {
            const candidateFiles = await globFiles(patterns, {
                ignore: ["node_modules", ".git", "venv", "__pycache__"]
            });
            const files = candidateFiles.filter((file) => /conversation|history|session|thread|transcript/i.test(file));
            const conversations = [];
            const warnings = [];
            for (const filePath of files) {
                if (filePath.endsWith(".jsonl")) {
                    const result = await readJsonlFile(source, filePath, parseGenericJsonLine);
                    conversations.push(...result.conversations);
                    warnings.push(...result.warnings);
                    continue;
                }
                try {
                    const raw = await readFile(filePath, "utf8");
                    const parsed = JSON.parse(raw);
                    const entries = extractMessageArray(parsed);
                    const messages = entries.flatMap((entry, index) => compactMessage(parseGenericMessage(entry, {
                        source,
                        conversationId: basename(filePath).replace(/\.[^.]+$/, ""),
                        sourceFile: filePath,
                        fallbackTimestamp: fileTimestamp(filePath),
                        index
                    })));
                    pushConversation(conversations, source, filePath, messages);
                }
                catch {
                    warnings.push({ file: filePath, line: 0, reason: `Malformed ${source} log skipped.` });
                }
            }
            return { conversations, warnings };
        }
    };
}
async function readJsonlTree(source, roots, parser) {
    const files = (await Promise.all(roots.map((root) => globFiles(`${root.replace(/\/+$/, "")}/**/*.jsonl`))))
        .flat()
        .sort();
    const conversations = [];
    const warnings = [];
    for (const filePath of files) {
        const result = await readJsonlFile(source, filePath, parser);
        conversations.push(...result.conversations);
        warnings.push(...result.warnings);
    }
    return { conversations, warnings };
}
async function readJsonlFile(source, filePath, parser) {
    const messages = [];
    const warnings = [];
    const fallbackTimestamp = fileTimestamp(filePath);
    const conversationId = basename(filePath, ".jsonl");
    const lines = createInterface({
        input: createReadStream(filePath, { encoding: "utf8" }),
        crlfDelay: Infinity
    });
    let lineNumber = 0;
    for await (const line of lines) {
        lineNumber += 1;
        if (!line.trim()) {
            continue;
        }
        try {
            const parsed = JSON.parse(line);
            const message = parser(parsed, {
                source,
                conversationId,
                sourceFile: filePath,
                fallbackTimestamp,
                line: lineNumber
            });
            if (message) {
                messages.push(message);
            }
        }
        catch {
            warnings.push({ file: filePath, line: lineNumber, reason: "Invalid JSONL record skipped." });
        }
    }
    return {
        conversations: messages.length === 0
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
function parseCodexLine(record, context) {
    if (!isObject(record) || record.type !== "response_item" || !isObject(record.payload)) {
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
        timestamp: typeof record.timestamp === "string" ? record.timestamp : undefined,
        sourceFile: context.sourceFile
    };
}
function parseClaudeLine(record, context) {
    if (!isObject(record)) {
        return null;
    }
    const role = normalizeRole(record.role ?? record.type);
    const message = isObject(record.message) ? record.message : record;
    const text = extractText(message.content ?? record.content).join("\n").trim();
    if (!text || isContextInjection(role, text)) {
        return null;
    }
    return {
        agent: "claude",
        source: "claude",
        conversationId: context.conversationId,
        role,
        text,
        timestamp: typeof record.timestamp === "string"
            ? record.timestamp
            : typeof record.createdAt === "string"
                ? record.createdAt
                : undefined,
        sourceFile: context.sourceFile
    };
}
function parseGenericJsonLine(record, context) {
    return parseGenericMessage(record, {
        source: context.source,
        conversationId: context.conversationId,
        sourceFile: context.sourceFile,
        fallbackTimestamp: context.fallbackTimestamp,
        index: context.line
    });
}
function parseGenericMessage(entry, context) {
    if (!isObject(entry)) {
        return null;
    }
    const message = isObject(entry.message) ? entry.message : entry;
    const role = normalizeRole(message.role ?? entry.role ?? entry.type);
    const text = extractText(message.content ?? entry.content ?? message.text ?? entry.text).join("\n").trim();
    if (!text || isContextInjection(role, text)) {
        return null;
    }
    const timestamp = stringTimestamp(entry.timestamp) ??
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
function normalizeRole(role) {
    if (role === "assistant" || role === "user" || role === "developer" || role === "system") {
        return role;
    }
    return "unknown";
}
function isContextInjection(role, text) {
    if (role !== "user") {
        return false;
    }
    const trimmed = text.trimStart();
    return (trimmed.startsWith("<environment_context>") ||
        trimmed.startsWith("<permissions instructions>") ||
        trimmed.startsWith("# AGENTS.md instructions for ") ||
        (trimmed.includes("<environment_context>") && trimmed.includes("<INSTRUCTIONS>")));
}
function extractText(content) {
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
function buildLexiconIndexes(lexicon = defaultSwearLexicon) {
    const tokenIndex = new Map();
    const phraseVariants = [];
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
            tokenIndex.set(normalizedVariant, entry.root);
        }
    }
    phraseVariants.sort((left, right) => right.variant.length - left.variant.length || left.variant.localeCompare(right.variant));
    return { tokenIndex, phraseVariants };
}
function buildPhrasePattern(variant) {
    const words = variant.split(/[\s-]+/).map(escapeRegExp);
    return new RegExp(`\\b${words.join("[\\s-]*")}\\b`, "gi");
}
function findOccurrences(text, tokenIndex, phraseVariants) {
    const occurrences = [];
    const phraseRanges = [];
    for (const phrase of phraseVariants) {
        phrase.pattern.lastIndex = 0;
        for (const match of text.matchAll(phrase.pattern)) {
            const matchedText = match[0];
            const start = match.index ?? 0;
            const end = start + matchedText.length;
            if (!/[\s-]/.test(matchedText) && tokenIndex.has(normalizeToken(matchedText))) {
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
function tokenizeWithSpans(text) {
    const matches = [];
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
function addOccurrence(wordStats, actualWordStats, occurrence) {
    const currentWord = wordStats.get(occurrence.root) ?? {
        root: occurrence.root,
        count: 0,
        variants: {}
    };
    currentWord.count += 1;
    currentWord.variants[occurrence.variant] = (currentWord.variants[occurrence.variant] ?? 0) + 1;
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
function buildDailyStats(conversations) {
    const byDay = new Map();
    for (const conversation of conversations) {
        const current = byDay.get(conversation.dateKey) ??
            {
                dateKey: conversation.dateKey,
                conversations: 0,
                messages: 0,
                messagesWithSwears: 0,
                swears: 0,
                swearingMessagePercent: 0
            };
        current.conversations += 1;
        current.messages += conversation.messages;
        current.messagesWithSwears += conversation.messagesWithSwears;
        current.swears += conversation.swears;
        current.swearingMessagePercent =
            current.messages === 0 ? 0 : (current.messagesWithSwears / current.messages) * 100;
        byDay.set(conversation.dateKey, current);
    }
    return [...byDay.values()].sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}
function compactMessage(message) {
    return message ? [message] : [];
}
function extractMessageArray(value) {
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
function pushConversation(conversations, source, filePath, messages) {
    if (messages.length === 0) {
        return;
    }
    conversations.push({
        source,
        conversationId: messages[0]?.conversationId ?? basename(filePath).replace(/\.[^.]+$/, ""),
        sourceFile: filePath,
        updatedAt: maxTimestamp(messages) ?? fileTimestamp(filePath),
        messages
    });
}
function dayKey(value, timeZone) {
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
    return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}
function isConversationInDateRange(conversation, options) {
    const updatedAtMs = Date.parse(conversation.updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
        return false;
    }
    if (options.date && dayKey(conversation.updatedAt, options.timeZone) !== options.date) {
        return false;
    }
    if (options.since && updatedAtMs < options.since.getTime()) {
        return false;
    }
    if (options.until && updatedAtMs >= options.until.getTime()) {
        return false;
    }
    return true;
}
function maxTimestamp(messages) {
    let max = Number.NEGATIVE_INFINITY;
    let value = null;
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
function fileTimestamp(filePath) {
    try {
        return statSync(filePath).mtime.toISOString();
    }
    catch {
        return new Date(0).toISOString();
    }
}
function dataHome() {
    return process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
}
function getVSCodeGlobalStoragePaths() {
    if (process.platform === "darwin") {
        return [
            join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage"),
            join(homedir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage"),
            join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage")
        ];
    }
    if (process.platform === "linux") {
        const configBase = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
        return [
            join(configBase, "Code", "User", "globalStorage"),
            join(configBase, "Code - Insiders", "User", "globalStorage"),
            join(configBase, "Cursor", "User", "globalStorage")
        ];
    }
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return [
        join(appData, "Code", "User", "globalStorage"),
        join(appData, "Code - Insiders", "User", "globalStorage")
    ];
}
function findFirstExisting(paths) {
    return paths.find((path) => existsSync(path)) ?? null;
}
async function globFiles(patterns, options = {}) {
    const results = new Set();
    for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
        const normalizedPattern = normalizePath(pattern);
        const root = globRoot(pattern);
        if (!root || !existsSync(root)) {
            continue;
        }
        const matcher = globPatternToRegExp(normalizedPattern);
        for await (const filePath of walkFiles(root, options.ignore ?? [])) {
            if (matcher.test(normalizePath(filePath))) {
                results.add(filePath);
            }
        }
    }
    return [...results].sort();
}
async function* walkFiles(root, ignoredNames) {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (ignoredNames.includes(entry.name)) {
            continue;
        }
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(fullPath, ignoredNames);
            continue;
        }
        if (entry.isFile()) {
            yield fullPath;
        }
    }
}
function globRoot(pattern) {
    const firstGlob = pattern.search(/[*{]/);
    if (firstGlob < 0) {
        return statIsFile(pattern) ? pattern : pathDirectory(pattern);
    }
    const prefix = pattern.slice(0, firstGlob).replace(/[\\/]+$/, "");
    return prefix ? resolve(prefix) : resolve(sep);
}
function pathDirectory(value) {
    const trimmed = value.replace(/[\\/]+$/, "");
    return resolve(dirname(trimmed || "."));
}
function globPatternToRegExp(pattern) {
    let expression = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        const next = pattern[index + 1];
        if (char === "*" && next === "*") {
            const after = pattern[index + 2];
            if (after === "/") {
                expression += "(?:.*/)?";
                index += 2;
            }
            else {
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
function normalizePath(value) {
    return resolve(value).split(sep).join("/");
}
function statIsFile(value) {
    try {
        return statSync(value).isFile();
    }
    catch {
        return false;
    }
}
function loadBetterSqlite() {
    try {
        return require("better-sqlite3");
    }
    catch {
        return null;
    }
}
function stringTimestamp(value) {
    if (typeof value !== "string") {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function numberTimestamp(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
}
function normalizeToken(token) {
    return token
        .toLowerCase()
        .replaceAll("*", "")
        .replaceAll("_", "")
        .replaceAll("-", "")
        .replace(/^'+|'+$/g, "");
}
function normalizeAgent(agent) {
    return agent.trim().toLowerCase() || "unknown";
}
function overlapsAny(range, ranges) {
    return ranges.some((other) => range.start < other.end && range.end > other.start);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
