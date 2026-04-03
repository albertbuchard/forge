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
      <Badge className="bg-cyan-400/10 text-cyan-50">{preset.label}</Badge>
    ),
    menuBadge: (
      <Badge className="bg-cyan-400/10 text-cyan-50">{preset.label}</Badge>
    )
  })) satisfies EntityLinkOption[];

  const customOptions = normalizeNoteTags(tags)
    .filter((tag) => !presetValues.has(tag.toLowerCase()))
    .map((tag) => ({
      value: tag,
      label: tag,
      description: "Custom note tag",
      searchText: tag,
      badge: <Badge className="bg-white/[0.08] text-white/78">{tag}</Badge>,
      menuBadge: <Badge className="bg-white/[0.08] text-white/78">{tag}</Badge>
    })) satisfies EntityLinkOption[];

  return [...presetOptions, ...customOptions];
}

export function NoteTagsInput({
  value,
  onChange,
  placeholder = "Add a memory tag or create a custom tag"
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const options = buildOptions(value);

  return (
    <EntityLinkMultiSelect
      options={options}
      selectedValues={normalizeNoteTags(value)}
      onChange={(next) => onChange(normalizeNoteTags(next))}
      placeholder={placeholder}
      emptyMessage="No note tags yet."
      createLabel="Add custom tag"
      onCreate={async (query) => {
        const tag = query.trim();
        return {
          value: tag,
          label: tag,
          description: "Custom note tag",
          searchText: tag,
          badge: <Badge className="bg-white/[0.08] text-white/78">{tag}</Badge>,
          menuBadge: (
            <Badge className="bg-white/[0.08] text-white/78">{tag}</Badge>
          )
        } satisfies EntityLinkOption;
      }}
    />
  );
}
