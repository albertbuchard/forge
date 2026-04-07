import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CloudSun,
  ExternalLink,
  Music4,
  NotebookPen,
  Save,
  TimerReset
} from "lucide-react";
import { createNote, createWikiPage } from "@/lib/api";
import { cn } from "@/lib/utils";

type WeatherSnapshot = {
  temperature: number;
  weatherCode: number;
};

function formatMonthGrid(baseDate: Date) {
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

function readStoredValue(key: string, fallback: string) {
  if (typeof window === "undefined") {
    return fallback;
  }
  return window.localStorage.getItem(key) ?? fallback;
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value);
}

export function TimeWidget({ compact }: { compact: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex h-full flex-col justify-between gap-4 rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white/45">
        <TimerReset className="size-4" />
        <span className="text-[12px] uppercase tracking-[0.16em]">
          Local time
        </span>
      </div>
      <div
        className={cn(
          "font-display text-white",
          compact ? "text-3xl" : "text-5xl"
        )}
      >
        {new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        }).format(now)}
      </div>
      <div className="text-sm text-white/58">
        {new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric"
        }).format(now)}
      </div>
    </div>
  );
}

export function MiniCalendarWidget({ compact }: { compact: boolean }) {
  const today = new Date();
  const days = useMemo(() => formatMonthGrid(today), [today]);
  const weekdayLabels = compact
    ? ["M", "T", "W", "T", "F", "S", "S"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="grid gap-3 rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-white">
          <CalendarDays className="size-4 text-[var(--primary)]" />
          {new Intl.DateTimeFormat(undefined, {
            month: "long",
            year: "numeric"
          }).format(today)}
        </div>
        <div className="text-[12px] text-white/45">
          {compact ? "Mini" : "Month view"}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="text-center text-[11px] uppercase tracking-[0.14em] text-white/35"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const isCurrentMonth = day.getMonth() === today.getMonth();
          const isToday = day.toDateString() === today.toDateString();
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "flex min-h-9 items-center justify-center rounded-xl text-sm",
                isToday
                  ? "bg-[var(--primary)] text-slate-950"
                  : isCurrentMonth
                    ? "bg-white/[0.04] text-white/78"
                    : "bg-transparent text-white/24"
              )}
            >
              {day.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SpotifyWidget({ surfaceId }: { surfaceId: string }) {
  const storageKey = `forge.utility.spotify.${surfaceId}`;
  const [url, setUrl] = useState(() =>
    readStoredValue(storageKey, "https://open.spotify.com/")
  );

  useEffect(() => {
    writeStoredValue(storageKey, url);
  }, [storageKey, url]);

  return (
    <div className="grid h-full gap-3 rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white">
        <Music4 className="size-4 text-[var(--secondary)]" />
        <span className="text-sm font-semibold">Spotify link</span>
      </div>
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]"
        placeholder="Paste a playlist, album, or artist URL"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(78,222,163,0.14)] px-3 py-2 text-sm font-medium text-[var(--secondary)] transition hover:bg-[rgba(78,222,163,0.22)]"
      >
        Open Spotify
        <ExternalLink className="size-4" />
      </a>
    </div>
  );
}

export function WeatherWidget({ compact }: { compact: boolean }) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [status, setStatus] = useState("Locating…");

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("Location unavailable");
      return;
    }

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${position.coords.latitude}&longitude=${position.coords.longitude}&current=temperature_2m,weather_code`
          );
          const payload = (await response.json()) as {
            current?: { temperature_2m?: number; weather_code?: number };
          };
          if (cancelled || !payload.current) {
            return;
          }
          setWeather({
            temperature: Number(payload.current.temperature_2m ?? 0),
            weatherCode: Number(payload.current.weather_code ?? 0)
          });
          setStatus("Live");
        } catch {
          if (!cancelled) {
            setStatus("Weather unavailable");
          }
        }
      },
      () => {
        if (!cancelled) {
          setStatus("Permission denied");
        }
      },
      { maximumAge: 300000, timeout: 6000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col justify-between gap-4 rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white">
        <CloudSun className="size-4 text-[var(--tertiary)]" />
        <span className="text-sm font-semibold">Weather</span>
      </div>
      {weather ? (
        <>
          <div
            className={cn(
              "font-display text-white",
              compact ? "text-3xl" : "text-5xl"
            )}
          >
            {Math.round(weather.temperature)}°
          </div>
          <div className="text-sm text-white/58">
            Code {weather.weatherCode} · {status}
          </div>
        </>
      ) : (
        <div className="text-sm text-white/58">{status}</div>
      )}
    </div>
  );
}

export function QuickCaptureWidget({
  compact,
  defaultUserId
}: {
  compact: boolean;
  defaultUserId?: string | null;
}) {
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const noteMutation = useMutation({
    mutationFn: async () =>
      createNote({
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
    mutationFn: async () =>
      createWikiPage({
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

  function wrapSelection(prefix: string, suffix = prefix) {
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

  return (
    <div className="grid h-full min-h-0 gap-3 rounded-[20px] bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-white">
        <NotebookPen className="size-4 text-[var(--primary)]" />
        <span className="text-sm font-semibold">Quick capture</span>
      </div>
      <input
        ref={titleRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]"
        placeholder="Title"
      />
      <div className="flex flex-wrap gap-2">
        {[
          { label: "B", action: () => wrapSelection("**") },
          { label: "I", action: () => wrapSelection("_") },
          { label: "H1", action: () => wrapSelection("# ", "") },
          { label: "[]", action: () => wrapSelection("- [ ] ", "") }
        ].map((tool) => (
          <button
            key={tool.label}
            type="button"
            className="inline-flex min-h-8 items-center justify-center rounded-xl bg-white/[0.05] px-2.5 text-[12px] font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white"
            onClick={tool.action}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <textarea
        ref={contentRef}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className={cn(
          "min-h-0 w-full rounded-[20px] border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.35)]",
          compact ? "h-28" : "h-40"
        )}
        placeholder="Write a quick note or rough wiki draft"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(192,193,255,0.16)] px-3 py-2 text-sm font-medium text-[var(--primary)] transition hover:bg-[rgba(192,193,255,0.24)] disabled:opacity-50"
          disabled={!content.trim() || noteMutation.isPending}
          onClick={() => noteMutation.mutate()}
        >
          <Save className="size-4" />
          Save as note
        </button>
        <button
          type="button"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-[rgba(255,185,95,0.16)] px-3 py-2 text-sm font-medium text-[var(--tertiary)] transition hover:bg-[rgba(255,185,95,0.24)] disabled:opacity-50"
          disabled={!content.trim() || wikiMutation.isPending}
          onClick={() => wikiMutation.mutate()}
        >
          <NotebookPen className="size-4" />
          Save as wiki
        </button>
      </div>
    </div>
  );
}
