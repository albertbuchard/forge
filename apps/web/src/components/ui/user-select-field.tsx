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
      <span className="text-sm font-medium text-white">{label}</span>
      {help ? (
        <span className="text-xs leading-5 text-white/52">{help}</span>
      ) : null}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-h-10 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-[rgba(192,193,255,0.3)]"
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
