export function MasteryRing({
  value,
  size = 62,
  label
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(var(--course-red) ${normalized * 3.6}deg, var(--course-line) 0deg)`
      }}
      role="img"
      aria-label={label ?? `${normalized}% mastery`}
    >
      <div className="absolute inset-[5px] rounded-full bg-[var(--course-paper)]" />
      <span className="relative font-label text-[11px] font-bold text-[var(--course-navy)]">
        {normalized}%
      </span>
    </div>
  );
}
