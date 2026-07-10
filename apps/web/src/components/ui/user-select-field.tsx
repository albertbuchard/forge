import type { UserSummary } from "@/lib/types";

export function UserSelectField({
  value,
  users,
  onChange,
  label = "Owner",
  defaultLabel = "Default Forge owner",
  help
}: {
  value: string | null | undefined;
  users: UserSummary[];
  onChange: (userId: string | null) => void;
  label?: string;
  defaultLabel?: string;
  help?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-[var(--ui-ink-strong)]">
        {label}
      </span>
      {help ? (
        <span className="text-xs leading-5 text-[var(--ui-ink-soft)]">
          {help}
        </span>
      ) : null}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-h-10 rounded-[var(--radius-control)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] px-3 py-2 text-sm text-[var(--ui-ink-strong)] outline-none transition focus:border-[color-mix(in_srgb,var(--primary)_30%,var(--ui-border-strong)_70%)]"
      >
        <option value="">{defaultLabel}</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.displayName} · {user.kind}
          </option>
        ))}
      </select>
    </label>
  );
}
