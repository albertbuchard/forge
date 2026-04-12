import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CloudSun, ExternalLink, Music4, NotebookPen, Save, TimerReset } from "lucide-react";
import { createNote, createWikiPage } from "../../lib/api.js";
import { buildStaticWorkbenchExecution } from "../../lib/workbench/runtime.js";
import { createContextOutput, createNoteTool, createSummaryOutput } from "../../lib/workbench/contracts.js";
import { cn } from "../../lib/utils.js";
import { createGenericWorkbenchNodeView } from "../workbench-boxes/shared/generic-node-view.js";
function formatMonthGrid(baseDate) {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const startOffset = (start.getDay() + 6) % 7;
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - startOffset);
    return Array.from({ length: 35 }, (_, index) => {
        const current = new Date(cursor);
        current.setDate(cursor.getDate() + index);
        return current;
    });
}
function readStoredValue(key, fallback) {
    if (typeof window === "undefined") {
        return fallback;
    }
    return window.localStorage.getItem(key) ?? fallback;
}
function writeStoredValue(key, value) {
    if (typeof window === "undefined") {
        return;
    }
    window.localStorage.setItem(key, value);
}
export function TimeWidget({ compact }) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 30_000);
        return () => window.clearInterval(timer);
    }, []);
    return (_jsxs("div", { className: "flex h-full flex-col justify-between gap-4 rounded-[20px] bg-white/[0.03] p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-white/45", children: [_jsx(TimerReset, { className: "size-4" }), _jsx("span", { className: "text-[12px] uppercase tracking-[0.16em]", children: "Local time" })] }), _jsx("div", { className: cn("font-display text-white", compact ? "text-3xl" : "text-5xl"), children: new Intl.DateTimeFormat(undefined, {
                    hour: "2-digit",
                    minute: "2-digit"
                }).format(now) }), _jsx("div", { className: "text-sm text-white/58", children: new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric"
                }).format(now) })] }));
}
export function MiniCalendarWidget({ compact }) {
    const today = new Date();
    const days = useMemo(() => formatMonthGrid(today), [today]);
    const weekdayLabels = compact
        ? ["M", "T", "W", "T", "F", "S", "S"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return (_jsxs("div", { className: "grid gap-3 rounded-[20px] bg-white/[0.03] p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm text-white", children: [_jsx(CalendarDays, { className: "size-4 text-[var(--primary)]" }), new Intl.DateTimeFormat(undefined, {
                                month: "long",
                                year: "numeric"
                            }).format(today)] }), _jsx("div", { className: "text-[12px] text-white/45", children: compact ? "Mini" : "Month view" })] }), _jsxs("div", { className: "grid grid-cols-7 gap-1.5", children: [weekdayLabels.map((label) => (_jsx("div", { className: "text-center text-[11px] uppercase tracking-[0.14em] text-white/35", children: label }, label))), days.map((day) => {
                        const isCurrentMonth = day.getMonth() === today.getMonth();
                        const isToday = day.toDateString() === today.toDateString();
                        return (_jsx("div", { className: cn("flex min-h-9 items-center justify-center rounded-xl text-sm", isToday
                                ? "bg-[var(--primary)] text-slate-950"
                                : isCurrentMonth
                                    ? "bg-white/[0.04] text-white/78"
                                    : "bg-transparent text-white/24"), children: day.getDate() }, day.toISOString()));
                    })] })] }));
}
export function SpotifyWidget({ surfaceId }) {
    const storageKey = `forge.utility.spotify.${surfaceId}`;
    const [url, setUrl] = useState(() => readStoredValue(storageKey, "https://open.spotify.com/"));
    useEffect(() => {
        writeStoredValue(storageKey, url);
    }, [storageKey, url]);
    return (_jsxs("div", { className: "grid h-full gap-3 rounded-[20px] bg-white/[0.03] p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-white", children: [_jsx(Music4, { className: "size-4 text-[var(--secondary)]" }), _jsx("span", { className: "text-sm font-semibold", children: "Spotify link" })] }), _jsx("input", { value: url, onChange: (event) => setUrl(event.target.value), className: "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]", placeholder: "Paste a playlist, album, or artist URL" }), _jsxs("a", { href: url, target: "_blank", rel: "noreferrer", className: "inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(78,222,163,0.14)] px-3 py-2 text-sm font-medium text-[var(--secondary)] transition hover:bg-[rgba(78,222,163,0.22)]", children: ["Open Spotify", _jsx(ExternalLink, { className: "size-4" })] })] }));
}
export function WeatherWidget({ compact }) {
    const [weather, setWeather] = useState(null);
    const [status, setStatus] = useState("Locating…");
    useEffect(() => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            setStatus("Location unavailable");
            return;
        }
        let cancelled = false;
        navigator.geolocation.getCurrentPosition(async (position) => {
            try {
                const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&current=temperature_2m,weather_code`);
                const payload = (await response.json());
                if (cancelled || !payload.current) {
                    return;
                }
                setWeather({
                    temperature: Number(payload.current.temperature_2m ?? 0),
                    weatherCode: Number(payload.current.weather_code ?? 0)
                });
                setStatus("Live");
            }
            catch {
                if (!cancelled) {
                    setStatus("Weather unavailable");
                }
            }
        }, () => {
            if (!cancelled) {
                setStatus("Permission denied");
            }
        }, { maximumAge: 300000, timeout: 6000 });
        return () => {
            cancelled = true;
        };
    }, []);
    return (_jsxs("div", { className: "flex h-full flex-col justify-between gap-4 rounded-[20px] bg-white/[0.03] p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-white", children: [_jsx(CloudSun, { className: "size-4 text-[var(--tertiary)]" }), _jsx("span", { className: "text-sm font-semibold", children: "Weather" })] }), weather ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: cn("font-display text-white", compact ? "text-3xl" : "text-5xl"), children: [Math.round(weather.temperature), "\u00B0"] }), _jsxs("div", { className: "text-sm text-white/58", children: ["Code ", weather.weatherCode, " \u00B7 ", status] })] })) : (_jsx("div", { className: "text-sm text-white/58", children: status }))] }));
}
export function QuickCaptureWidget({ compact, defaultUserId }) {
    const queryClient = useQueryClient();
    const titleRef = useRef(null);
    const contentRef = useRef(null);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const noteMutation = useMutation({
        mutationFn: async () => createNote({
            contentMarkdown: `# ${title.trim() || "Quick note"}\n\n${content.trim()}`,
            author: "Forge quick capture",
            userId: defaultUserId ?? null,
            links: []
        }),
        onSuccess: async () => {
            setTitle("");
            setContent("");
            await queryClient.invalidateQueries({ queryKey: ["notes-index"] });
        }
    });
    const wikiMutation = useMutation({
        mutationFn: async () => createWikiPage({
            title: title.trim() || "Quick capture",
            contentMarkdown: content.trim(),
            summary: content.trim().slice(0, 180),
            author: "Forge quick capture"
        }),
        onSuccess: async () => {
            setTitle("");
            setContent("");
            await queryClient.invalidateQueries({ queryKey: ["wiki-pages"] });
        }
    });
    function wrapSelection(prefix, suffix = prefix) {
        const node = contentRef.current;
        if (!node) {
            return;
        }
        const start = node.selectionStart ?? 0;
        const end = node.selectionEnd ?? 0;
        const selected = content.slice(start, end);
        const next = `${content.slice(0, start)}${prefix}${selected}${suffix}${content.slice(end)}`;
        setContent(next);
        requestAnimationFrame(() => {
            node.focus();
            node.selectionStart = start + prefix.length;
            node.selectionEnd = end + prefix.length;
        });
    }
    return (_jsxs("div", { className: "grid h-full min-h-0 gap-3 rounded-[20px] bg-white/[0.03] p-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-white", children: [_jsx(NotebookPen, { className: "size-4 text-[var(--primary)]" }), _jsx("span", { className: "text-sm font-semibold", children: "Quick capture" })] }), _jsx("input", { ref: titleRef, value: title, onChange: (event) => setTitle(event.target.value), className: "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]", placeholder: "Title" }), _jsx("div", { className: "flex flex-wrap gap-2", children: [
                    { label: "B", action: () => wrapSelection("**") },
                    { label: "I", action: () => wrapSelection("_") },
                    { label: "H1", action: () => wrapSelection("# ", "") },
                    { label: "[]", action: () => wrapSelection("- [ ] ", "") }
                ].map((tool) => (_jsx("button", { type: "button", className: "inline-flex min-h-8 items-center justify-center rounded-xl bg-white/[0.05] px-2.5 text-[12px] font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white", onClick: tool.action, children: tool.label }, tool.label))) }), _jsx("textarea", { ref: contentRef, value: content, onChange: (event) => setContent(event.target.value), className: cn("min-h-0 w-full rounded-[20px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]", compact ? "h-28" : "h-40"), placeholder: "Write a quick note or rough wiki draft" }), _jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [_jsxs("button", { type: "button", className: "inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(192,193,255,0.16)] px-3 py-2 text-sm font-medium text-[var(--primary)] transition hover:bg-[rgba(192,193,255,0.24)] disabled:opacity-50", disabled: !content.trim() || noteMutation.isPending, onClick: () => noteMutation.mutate(), children: [_jsx(Save, { className: "size-4" }), "Save as note"] }), _jsxs("button", { type: "button", className: "inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(255,185,95,0.16)] px-3 py-2 text-sm font-medium text-[var(--tertiary)] transition hover:bg-[rgba(255,185,95,0.24)] disabled:opacity-50", disabled: !content.trim() || wikiMutation.isPending, onClick: () => wikiMutation.mutate(), children: [_jsx(NotebookPen, { className: "size-4" }), "Save as wiki"] })] })] }));
}
const timeWidgetDefinition = {
    id: "surface:utility:time",
    surfaceId: "utility",
    routePath: null,
    title: "Clock",
    icon: "timer",
    description: "Live local time widget.",
    category: "Utilities",
    tags: ["utility", "clock"],
    inputs: [],
    params: [],
    output: [
        createSummaryOutput({
            label: "Current time",
            description: "Formatted local time string published by the clock widget."
        }),
        createContextOutput({
            key: "clock",
            label: "Clock state",
            description: "Structured clock state including the current ISO timestamp.",
            modelName: "ForgeClockState"
        })
    ],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Clock",
        description: "Live local time widget.",
        inputs: [],
        params: [],
        output: [
            createSummaryOutput({
                label: "Current time",
                description: "Formatted local time string published by the clock widget."
            }),
            createContextOutput({
                key: "clock",
                label: "Clock state",
                description: "Structured clock state including the current ISO timestamp.",
                modelName: "ForgeClockState"
            })
        ],
        tools: []
    }),
    WebView: TimeWidget,
    execute: (input) => buildStaticWorkbenchExecution(input, {
        clock: {
            now: input.context.now
        }
    }, new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(input.context.now)))
};
TimeWidget.workbench = timeWidgetDefinition;
const calendarWidgetDefinition = {
    id: "surface:utility:mini-calendar",
    surfaceId: "utility",
    routePath: null,
    title: "Mini calendar",
    icon: "calendar",
    description: "Compact month calendar widget.",
    category: "Utilities",
    tags: ["utility", "calendar"],
    inputs: [],
    params: [],
    output: [
        createSummaryOutput({
            label: "Month view",
            description: "Summary of the compact month calendar widget."
        }),
        createContextOutput({
            key: "calendarView",
            label: "Calendar view",
            description: "Structured mini-calendar state including the current month anchor.",
            modelName: "ForgeMiniCalendarView"
        })
    ],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Mini calendar",
        description: "Compact month calendar widget.",
        inputs: [],
        params: [],
        output: [
            createSummaryOutput({
                label: "Month view",
                description: "Summary of the compact month calendar widget."
            }),
            createContextOutput({
                key: "calendarView",
                label: "Calendar view",
                description: "Structured mini-calendar state including the current month anchor.",
                modelName: "ForgeMiniCalendarView"
            })
        ],
        tools: []
    }),
    WebView: MiniCalendarWidget,
    execute: (input) => buildStaticWorkbenchExecution(input, {
        calendarView: {
            now: input.context.now
        }
    }, "Compact month calendar")
};
MiniCalendarWidget.workbench = calendarWidgetDefinition;
const spotifyWidgetDefinition = {
    id: "surface:utility:spotify",
    surfaceId: "utility",
    routePath: null,
    title: "Spotify",
    icon: "music",
    description: "Pinned music link widget.",
    category: "Utilities",
    tags: ["utility", "spotify"],
    inputs: [
        {
            key: "surfaceId",
            label: "Surface id",
            kind: "text",
            required: false
        }
    ],
    params: [],
    output: [
        createSummaryOutput({
            label: "Spotify link",
            description: "Summary of the pinned music link widget."
        }),
        createContextOutput({
            key: "spotifyLink",
            label: "Spotify state",
            description: "Structured Spotify widget state and pinned surface context.",
            modelName: "ForgeSpotifyWidgetState"
        })
    ],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Spotify",
        description: "Pinned music link widget.",
        inputs: [{ key: "surfaceId", label: "Surface id", kind: "text" }],
        params: [],
        output: [
            createSummaryOutput({
                label: "Spotify link",
                description: "Summary of the pinned music link widget."
            }),
            createContextOutput({
                key: "spotifyLink",
                label: "Spotify state",
                description: "Structured Spotify widget state and pinned surface context.",
                modelName: "ForgeSpotifyWidgetState"
            })
        ],
        tools: []
    }),
    WebView: SpotifyWidget,
    execute: (input) => buildStaticWorkbenchExecution(input, {
        spotifyLink: {
            surfaceId: input.inputs.surfaceId ?? null
        }
    }, "Pinned Spotify link")
};
SpotifyWidget.workbench = spotifyWidgetDefinition;
const weatherWidgetDefinition = {
    id: "surface:utility:weather",
    surfaceId: "utility",
    routePath: null,
    title: "Weather",
    icon: "weather",
    description: "Location-aware weather widget.",
    category: "Utilities",
    tags: ["utility", "weather"],
    inputs: [],
    params: [],
    output: [
        createSummaryOutput({
            label: "Weather summary",
            description: "Summary of the weather widget state."
        }),
        createContextOutput({
            key: "weather",
            label: "Weather payload",
            description: "Structured weather widget payload.",
            modelName: "ForgeWeatherWidgetState"
        })
    ],
    tools: [],
    NodeView: createGenericWorkbenchNodeView({
        title: "Weather",
        description: "Location-aware weather widget.",
        inputs: [],
        params: [],
        output: [
            createSummaryOutput({
                label: "Weather summary",
                description: "Summary of the weather widget state."
            }),
            createContextOutput({
                key: "weather",
                label: "Weather payload",
                description: "Structured weather widget payload.",
                modelName: "ForgeWeatherWidgetState"
            })
        ],
        tools: []
    }),
    WebView: WeatherWidget,
    execute: (input) => buildStaticWorkbenchExecution(input, { weather: null }, "Weather widget")
};
WeatherWidget.workbench = weatherWidgetDefinition;
const quickCaptureWidgetDefinition = {
    id: "surface:utility:quick-capture",
    surfaceId: "utility",
    routePath: null,
    title: "Quick capture",
    icon: "capture",
    description: "Draft a quick note or wiki page.",
    category: "Capture",
    tags: ["capture", "notes"],
    inputs: [
        {
            key: "defaultUserId",
            label: "Default user id",
            kind: "text",
            required: false
        }
    ],
    params: [],
    output: [
        createSummaryOutput({
            label: "Draft summary",
            description: "Summary of the quick-capture draft state."
        }),
        createContextOutput({
            key: "draft",
            label: "Draft context",
            description: "Structured quick-capture draft context.",
            modelName: "ForgeQuickCaptureDraft"
        })
    ],
    tools: [
        createNoteTool("Create a Forge evidence note from captured markdown.")
    ],
    NodeView: createGenericWorkbenchNodeView({
        title: "Quick capture",
        description: "Draft a quick note or wiki page.",
        inputs: [{ key: "defaultUserId", label: "Default user id", kind: "text" }],
        params: [],
        output: [
            createSummaryOutput({
                label: "Draft summary",
                description: "Summary of the quick-capture draft state."
            }),
            createContextOutput({
                key: "draft",
                label: "Draft context",
                description: "Structured quick-capture draft context.",
                modelName: "ForgeQuickCaptureDraft"
            })
        ],
        tools: [
            createNoteTool("Create a Forge evidence note from captured markdown.")
        ]
    }),
    WebView: QuickCaptureWidget,
    execute: (input) => buildStaticWorkbenchExecution(input, {
        draft: {
            defaultUserId: input.inputs.defaultUserId ?? null
        }
    }, "Quick capture can draft notes and wiki pages.")
};
QuickCaptureWidget.workbench = quickCaptureWidgetDefinition;
