function isOutputTextPart(part) {
    return (part !== null &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "output_text" &&
        typeof part.text === "string");
}
function parseJsonFromOutput(payload) {
    const output = Array.isArray(payload.output) ? payload.output : [];
    for (const item of output) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const content = Array.isArray(item.content)
            ? item.content
            : [];
        for (const part of content) {
            if (isOutputTextPart(part)) {
                return part.text;
            }
        }
    }
    return null;
}
function normalizeResult(content, input) {
    if (!content) {
        return null;
    }
    try {
        const parsed = JSON.parse(content);
        return {
            title: parsed.title?.trim() || input.titleHint || "Imported source",
            summary: parsed.summary?.trim() || "",
            markdown: parsed.markdown?.trim() || input.rawText.trim(),
            tags: Array.isArray(parsed.tags)
                ? parsed.tags.filter((tag) => typeof tag === "string")
                : [],
            entityProposals: Array.isArray(parsed.entityProposals)
                ? parsed.entityProposals.filter((entry) => entry !== null && typeof entry === "object")
                : [],
            pageUpdateSuggestions: Array.isArray(parsed.pageUpdateSuggestions)
                ? parsed.pageUpdateSuggestions.filter((entry) => entry !== null && typeof entry === "object")
                : [],
            articleCandidates: Array.isArray(parsed.articleCandidates)
                ? parsed.articleCandidates.filter((entry) => entry !== null && typeof entry === "object")
                : []
        };
    }
    catch {
        return null;
    }
}
export class OpenAiResponsesProvider {
    providerNames = ["openai", "openai-responses", "openai-compatible"];
    async compile({ apiKey, profile, input }) {
        const prompt = [
            "You compile user-provided source material into durable Forge wiki memory.",
            "Return strict JSON with keys title, summary, markdown, tags, entityProposals, pageUpdateSuggestions, articleCandidates.",
            "Forge markdown rules:",
            "- Use Markdown headings and concise sections.",
            "- Use [[wiki links]] for durable page references when the relationship is meaningful.",
            "- Prefer factual, readable, agent-usable writing over decorative prose.",
            "- If a concept should become its own page, put it in articleCandidates instead of bloating one page.",
            "- If a change belongs in an existing page, emit pageUpdateSuggestions with targetSlug and patchSummary.",
            "- If a source implies a Forge entity such as goal, project, habit, strategy, task, or note, emit entityProposals with entityType, title, summary, rationale, confidence, and suggestedFields.",
            "- Keep speculative entities conservative; durable pages can be broader than entity proposals.",
            profile.systemPrompt.trim()
        ]
            .filter(Boolean)
            .join("\n");
        const inputs = [
            {
                role: "system",
                content: [{ type: "input_text", text: prompt }]
            }
        ];
        const userContent = [
            {
                type: "input_text",
                text: `Title hint: ${input.titleHint || "none"}\nMime type: ${input.mimeType}\nParse strategy: ${input.parseStrategy}`
            }
        ];
        if (input.rawText.trim()) {
            userContent.push({
                type: "input_text",
                text: `Source:\n${input.rawText.slice(0, 24_000)}`
            });
        }
        if (input.binary &&
            input.parseStrategy !== "text_only" &&
            input.mimeType.startsWith("image/")) {
            userContent.push({
                type: "input_image",
                image_url: `data:${input.mimeType};base64,${input.binary.toString("base64")}`
            });
        }
        inputs.push({
            role: "user",
            content: userContent
        });
        const response = await fetch(`${profile.baseUrl.replace(/\/$/, "")}/responses`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: profile.model,
                temperature: 0.2,
                input: inputs,
                text: {
                    format: {
                        type: "json_schema",
                        name: "forge_wiki_ingest_compilation",
                        strict: true,
                        schema: {
                            type: "object",
                            additionalProperties: false,
                            properties: {
                                title: { type: "string" },
                                summary: { type: "string" },
                                markdown: { type: "string" },
                                tags: {
                                    type: "array",
                                    items: { type: "string" }
                                },
                                entityProposals: {
                                    type: "array",
                                    items: { type: "object", additionalProperties: true }
                                },
                                pageUpdateSuggestions: {
                                    type: "array",
                                    items: { type: "object", additionalProperties: true }
                                },
                                articleCandidates: {
                                    type: "array",
                                    items: { type: "object", additionalProperties: true }
                                }
                            },
                            required: [
                                "title",
                                "summary",
                                "markdown",
                                "tags",
                                "entityProposals",
                                "pageUpdateSuggestions",
                                "articleCandidates"
                            ]
                        }
                    }
                }
            })
        });
        if (!response.ok) {
            throw new Error(`LLM compilation failed: ${response.status}`);
        }
        const payload = (await response.json());
        return normalizeResult(parseJsonFromOutput(payload), input);
    }
}
