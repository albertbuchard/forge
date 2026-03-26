import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return <div className={cn("surface-pulse rounded-2xl bg-white/[0.05]", className)} />;
}

export function SurfaceSkeleton({
  header = true,
  sideRail = true,
  className,
  eyebrow,
  title,
  description,
  columns = 2,
  blocks = 4
}: {
  header?: boolean;
  sideRail?: boolean;
  className?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  columns?: number;
  blocks?: number;
}) {
  const mainBlocks = Array.from({ length: Math.max(2, blocks) });

  return (
    <div className={cn("grid gap-5", className)} aria-hidden="true">
      {header ? (
        <Card className="grid gap-4">
          <Block className={cn("h-3", eyebrow ? "w-40" : "w-32")} />
          <Block className={cn("h-12", title ? "max-w-2xl" : "max-w-3xl")} />
          <Block className={cn("h-5", description ? "max-w-3xl" : "max-w-2xl")} />
        </Card>
      ) : null}

      <section className={cn("grid gap-5", sideRail ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" : "")}>
        <div className="grid gap-5">
          <Card className="grid gap-4">
            <Block className="h-3 w-28" />
            <Block className="h-28 w-full" />
          </Card>
          <Card className="grid gap-4">
            <Block className="h-3 w-40" />
            <div className={cn("grid gap-3", columns > 1 ? "md:grid-cols-2" : "")}>
              {mainBlocks.map((_, index) => (
                <Block key={index} className="h-28 w-full" />
              ))}
            </div>
          </Card>
        </div>
        {sideRail ? (
          <div className="grid gap-5">
            <Card className="grid gap-4">
              <Block className="h-3 w-24" />
              <Block className="h-20 w-full" />
            </Card>
            <Card className="grid gap-4">
              <Block className="h-3 w-36" />
              <Block className="h-16 w-full" />
              <Block className="h-16 w-full" />
            </Card>
          </div>
        ) : null}
      </section>
    </div>
  );
}
