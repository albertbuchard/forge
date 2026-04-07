import { useRef, useState, type ChangeEvent } from "react";
import {
  FlowChoiceGrid,
  FlowField,
  QuestionFlowDialog,
  type QuestionFlowStep
} from "@/components/flows/question-flow-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  defaultCustomTheme,
  forgeCustomThemeSchema,
  forgeThemeCatalog,
  getForgeThemePreview,
  type ForgeCustomTheme
} from "@/lib/theme-system";

function ThemePreviewCard({
  theme,
  title,
  description
}: {
  theme: ForgeCustomTheme;
  title: string;
  description: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-[24px] border border-white/10"
      style={{
        background: `linear-gradient(180deg, ${theme.panelHigh}, ${theme.panelLow})`,
        color: theme.ink
      }}
    >
      <div
        className="px-4 py-4"
        style={{
          background: `radial-gradient(circle at top left, ${theme.primary}33, transparent 42%), radial-gradient(circle at top right, ${theme.secondary}2a, transparent 36%), linear-gradient(180deg, ${theme.panel}, ${theme.canvas})`
        }}
      >
        <div className="text-xs uppercase tracking-[0.2em] opacity-60">
          Preview
        </div>
        <div className="mt-2 font-display text-xl">{title}</div>
        <div className="mt-2 text-sm leading-6 opacity-72">{description}</div>
        <div className="mt-5 flex gap-2">
          {[theme.primary, theme.secondary, theme.tertiary, theme.panelHigh].map(
            (value) => (
              <div
                key={value}
                className="h-9 flex-1 rounded-[14px] border border-black/10"
                style={{ background: value }}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeColorField({
  label,
  value,
  onChange,
  description
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  description?: string;
}) {
  return (
    <FlowField label={label} description={description}>
      <div className="grid gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full cursor-pointer rounded-[18px] border border-white/10 bg-transparent p-1"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#7cc7ff"
        />
      </div>
    </FlowField>
  );
}

export function ThemeCustomizerDialog({
  open,
  onOpenChange,
  value,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ForgeCustomTheme;
  onSave: (theme: ForgeCustomTheme) => void;
}) {
  const [draft, setDraft] = useState<ForgeCustomTheme>(value);
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parseImport = (raw: string) => {
    const parsed = forgeCustomThemeSchema.parse(JSON.parse(raw));
    setDraft(parsed);
    setImportText(JSON.stringify(parsed, null, 2));
    setError(null);
  };

  const loadPreset = (preset: keyof typeof forgeThemeCatalog) => {
    const preview = getForgeThemePreview(preset);
    setDraft({
      ...preview,
      label: draft.label.trim().length > 0 ? draft.label : `${preview.label} Custom`
    });
  };

  const handleJsonFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      parseImport(await file.text());
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Forge could not parse that JSON theme."
      );
    } finally {
      event.target.value = "";
    }
  };

  const steps: Array<QuestionFlowStep<ForgeCustomTheme>> = [
    {
      id: "identity",
      eyebrow: "Custom theme",
      title: "Name the mood and choose a starting point",
      description:
        "Start from a Forge preset, then tune the accents and surfaces in the next steps.",
      render: (theme, setValue) => (
        <div className="grid gap-5">
          <FlowField
            label="Theme label"
            description="This label appears in Settings when the custom theme is active."
          >
            <Input
              value={theme.label}
              onChange={(event) => setValue({ label: event.target.value })}
              placeholder="Midnight Circuit"
            />
          </FlowField>
          <FlowField label="Starter preset">
            <FlowChoiceGrid
              value=""
              onChange={(next) => loadPreset(next as keyof typeof forgeThemeCatalog)}
              options={(
                Object.entries(forgeThemeCatalog) as Array<
                  [keyof typeof forgeThemeCatalog, (typeof forgeThemeCatalog)[keyof typeof forgeThemeCatalog]]
                >
              ).map(([key, preset]) => ({
                value: key,
                label: preset.label,
                description: preset.description
              }))}
              columns={2}
            />
          </FlowField>
          <ThemePreviewCard
            theme={theme}
            title={theme.label}
            description="Live preview of the current custom theme draft."
          />
        </div>
      )
    },
    {
      id: "accents",
      eyebrow: "Custom theme",
      title: "Set the accent colors",
      description:
        "These colors drive buttons, highlights, charts, and the ambient shell lighting.",
      render: (theme, setValue) => (
        <div className="grid gap-4">
          <ThemeColorField
            label="Primary"
            description="Main emphasis color for actions and active state."
            value={theme.primary}
            onChange={(primary) => setValue({ primary })}
          />
          <ThemeColorField
            label="Secondary"
            description="Support accent for positive or secondary emphasis."
            value={theme.secondary}
            onChange={(secondary) => setValue({ secondary })}
          />
          <ThemeColorField
            label="Tertiary"
            description="Warm contrast color for warnings, highlights, and supporting metrics."
            value={theme.tertiary}
            onChange={(tertiary) => setValue({ tertiary })}
          />
        </div>
      )
    },
    {
      id: "surfaces",
      eyebrow: "Custom theme",
      title: "Tune the shell surfaces",
      description:
        "Forge currently assumes a dark shell, so these should remain fairly deep colors for legibility.",
      render: (theme, setValue) => (
        <div className="grid gap-4">
          <ThemeColorField
            label="Canvas"
            description="Primary app background."
            value={theme.canvas}
            onChange={(canvas) => setValue({ canvas })}
          />
          <ThemeColorField
            label="Panel"
            description="Default card and rail background."
            value={theme.panel}
            onChange={(panel) => setValue({ panel })}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ThemeColorField
              label="Panel high"
              description="Raised highlights and stronger sections."
              value={theme.panelHigh}
              onChange={(panelHigh) => setValue({ panelHigh })}
            />
            <ThemeColorField
              label="Panel low"
              description="Lower contrast and deeper card areas."
              value={theme.panelLow}
              onChange={(panelLow) => setValue({ panelLow })}
            />
          </div>
          <ThemeColorField
            label="Ink"
            description="Main text and readable foreground color."
            value={theme.ink}
            onChange={(ink) => setValue({ ink })}
          />
          <ThemePreviewCard
            theme={theme}
            title={theme.label}
            description="Live preview after the current surface edits."
          />
        </div>
      )
    },
    {
      id: "import",
      eyebrow: "Custom theme",
      title: "Import or paste JSON directly",
      description:
        "You can skip the picker workflow entirely by uploading a JSON file or pasting a valid theme object.",
      render: (theme) => (
        <div className="grid gap-4">
          <FlowField
            label="Direct JSON"
            description="Paste a full custom theme object, then click Apply JSON."
          >
            <Textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              className="min-h-52 font-mono text-[13px] leading-6"
              placeholder={JSON.stringify(defaultCustomTheme, null, 2)}
            />
          </FlowField>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                try {
                  parseImport(importText);
                } catch (nextError) {
                  setError(
                    nextError instanceof Error
                      ? nextError.message
                      : "Forge could not parse that JSON theme."
                  );
                }
              }}
            >
              Apply JSON
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload JSON file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleJsonFile}
            />
          </div>
          <ThemePreviewCard
            theme={theme}
            title={theme.label}
            description="Preview of the theme that will be saved if you submit now."
          />
        </div>
      )
    }
  ];

  return (
    <QuestionFlowDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraft(value);
          setImportText("");
          setError(null);
        }
        onOpenChange(nextOpen);
      }}
      eyebrow="Settings"
      title="Forge custom theme"
      description="Build a dark Forge palette visually, or import one directly as JSON."
      value={draft}
      onChange={(next) => {
        setDraft(next);
        setError(null);
      }}
      steps={steps}
      error={error}
      onSubmit={async () => {
        try {
          const parsed = forgeCustomThemeSchema.parse(draft);
          onSave(parsed);
          onOpenChange(false);
        } catch (nextError) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Forge could not save that custom theme."
          );
        }
      }}
      submitLabel="Save custom theme"
      contentClassName="lg:w-[min(62rem,calc(100vw-1.5rem))]"
    />
  );
}
