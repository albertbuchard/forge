import { Badge } from "@/components/ui/badge";
import {
  EntityLinkMultiSelect,
  type EntityLinkOption
} from "@/components/psyche/entity-link-multiselect";
import {
  NOTE_MEMORY_TAG_PRESETS,
  normalizeNoteTags
} from "@/lib/note-memory-tags";

function buildOptions(tags: string[]): EntityLinkOption[] {
  const presetValues = new Set(
    NOTE_MEMORY_TAG_PRESETS.map((preset) => preset.value.toLowerCase())
  );
  const presetOptions = NOTE_MEMORY_TAG_PRESETS.map((preset) => ({
    value: preset.value,
    label: preset.label,
    description: preset.description,
    searchText: `${preset.label} ${preset.description}`,
    badge: (
      <Badge className="border border-[color-mix(in_srgb,var(--info)_32%,var(--ui-border-subtle)_68%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_74%,var(--ui-ink-strong)_26%)]">
        {preset.label}
      </Badge>
    ),
    menuBadge: (
      <Badge className="border border-[color-mix(in_srgb,var(--info)_32%,var(--ui-border-subtle)_68%)] bg-[var(--ui-info-soft)] text-[color-mix(in_srgb,var(--info)_74%,var(--ui-ink-strong)_26%)]">
        {preset.label}
      </Badge>
    )
  })) satisfies EntityLinkOption[];

  const customOptions = normalizeNoteTags(tags)
    .filter((tag) => !presetValues.has(tag.toLowerCase()))
    .map((tag) => ({
      value: tag,
      label: tag,
      description: "Custom note tag",
      searchText: tag,
      badge: (
        <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {tag}
        </Badge>
      ),
      menuBadge: (
        <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
          {tag}
        </Badge>
      )
    })) satisfies EntityLinkOption[];

  return [...presetOptions, ...customOptions];
}

export function NoteTagsInput({
  value,
  onChange,
  availableTags = [],
  placeholder = "Add a memory tag or create a custom tag"
}: {
  value: string[];
  onChange: (value: string[]) => void;
  availableTags?: string[];
  placeholder?: string;
}) {
  const options = buildOptions([...availableTags, ...value]);

  return (
    <EntityLinkMultiSelect
      options={options}
      selectedValues={normalizeNoteTags(value)}
      onChange={(next) =>
        onChange(
          normalizeNoteTags(next)
            .filter((tag) => tag.length <= 80)
            .slice(0, 24)
        )
      }
      placeholder={placeholder}
      emptyMessage="No note tags yet."
      createLabel="Add custom tag"
      onCreate={async (query) => {
        const tag = query.trim().slice(0, 80);
        return {
          value: tag,
          label: tag,
          description: "Custom note tag",
          searchText: tag,
          badge: (
            <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {tag}
            </Badge>
          ),
          menuBadge: (
            <Badge className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] text-[var(--ui-ink-medium)]">
              {tag}
            </Badge>
          )
        } satisfies EntityLinkOption;
      }}
    />
  );
}
