function emit(logger, level, message, details) {
    logger?.({ level, message, details });
}
function extractSection(prompt, label) {
    const match = prompt.match(new RegExp(`${label}:\\n([\\s\\S]*?)(?:\\n\\n[A-Z][^\\n]*:|$)`));
    return match?.[1]?.trim() ?? "";
}
function hasToolTranscript(prompt) {
    return prompt.includes("Tool transcript:");
}
function hasConversationHistory(prompt) {
    return prompt.includes("Conversation history:");
}
function resolveFixture(model) {
    const normalized = model.trim().toLowerCase();
    if (!normalized || normalized === "mock") {
        return "mock-echo";
    }
    return normalized;
}
function buildEchoJson(prompt) {
    const userInput = extractSection(prompt, "User input");
    const linkedInputs = extractSection(prompt, "Linked inputs");
    const answer = linkedInputs
        ? `Mock consumed linked inputs${userInput ? ` and user input "${userInput}".` : "."}`
        : userInput || "Mock workflow completed.";
    return JSON.stringify({
        answer,
        summary: linkedInputs
            ? `Mock consumed linked inputs and user input "${userInput || "none"}".`
            : `Mock consumed user input "${userInput || "none"}".`,
        linkedInputs: linkedInputs || null
    });
}
export class MockWorkbenchProvider {
    providerNames = ["mock"];
    async compile(input) {
        emit(input.logger, "info", "Running mock wiki compile.", {
            model: input.profile.model
        });
        return {
            title: input.input.titleHint || "Mock page",
            summary: "Mock wiki compile output.",
            markdown: input.input.rawText || "# Mock page",
            tags: ["mock"],
            entityProposals: [],
            pageUpdateSuggestions: [],
            articleCandidates: []
        };
    }
    async testConnection(input) {
        emit(input.logger, "info", "Testing mock workbench connection.", {
            model: input.profile.model
        });
        return {
            outputPreview: `Mock provider ready (${resolveFixture(input.profile.model)}).`
        };
    }
    async runText(input) {
        const fixture = resolveFixture(input.profile.model);
        emit(input.logger, "debug", "Running mock workbench prompt.", {
            fixture
        });
        if (fixture === "mock-fail") {
            throw new Error("Mock provider forced a failure for this run.");
        }
        if (fixture === "mock-malformed") {
            return { outputText: "{mock:" };
        }
        if (fixture === "mock-tool-search") {
            if (!hasToolTranscript(input.prompt)) {
                return {
                    outputText: JSON.stringify({
                        action: "tool",
                        tool: "forge.search_entities",
                        args: {
                            query: "missed habits",
                            entityTypes: ["habit"],
                            limit: 6
                        }
                    })
                };
            }
            return {
                outputText: JSON.stringify({
                    action: "final",
                    text: JSON.stringify({
                        answer: "Found missed habits and summarized them.",
                        summary: "Found missed habits and summarized them.",
                        missedHabits: [{ id: "habit_mock_1", title: "Morning mobility" }]
                    })
                })
            };
        }
        if (fixture === "mock-tool-note") {
            if (!hasToolTranscript(input.prompt)) {
                return {
                    outputText: JSON.stringify({
                        action: "tool",
                        tool: "forge.create_note",
                        args: {
                            title: "Mock note",
                            summary: "Created by mock provider",
                            markdown: "Mock workbench note"
                        }
                    })
                };
            }
            return {
                outputText: JSON.stringify({
                    action: "final",
                    text: JSON.stringify({
                        answer: "Created a mock note.",
                        summary: "Created a mock note.",
                        noteStatus: "created"
                    })
                })
            };
        }
        if (fixture === "mock-chat-memory") {
            const userInput = extractSection(input.prompt, "User input");
            return {
                outputText: JSON.stringify({
                    answer: hasConversationHistory(input.prompt)
                        ? `I remember our earlier exchange and your latest message: ${userInput || "none"}.`
                        : `Starting a fresh conversation with: ${userInput || "none"}.`,
                    summary: hasConversationHistory(input.prompt)
                        ? "Mock chat reused prior conversation history."
                        : "Mock chat started fresh."
                })
            };
        }
        if (fixture === "mock-json") {
            return {
                outputText: JSON.stringify({
                    answer: "Mock JSON output.",
                    summary: "Mock JSON output.",
                    payload: {
                        ok: true,
                        fixture
                    }
                })
            };
        }
        return {
            outputText: buildEchoJson(input.prompt)
        };
    }
}
