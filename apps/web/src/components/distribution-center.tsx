import { useEffect, useState } from "react";
import { CheckCircle2, Download, ExternalLink, Laptop, RefreshCw, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { checkDesktopUpdate, installDesktopUpdate, type DesktopUpdateStatus } from "@/lib/desktop-distribution";

export function DistributionCenter() {
  const [desktop, setDesktop] = useState<DesktopUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setDesktop(await checkDesktopUpdate());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Forge could not check for updates.");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <section className="grid gap-5">
      <div>
        <h2 className="text-lg font-semibold">Install and update Forge without a terminal</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--ui-ink-medium)]">
          Desktop updates are accepted only when the package signature matches the public key pinned into the installed app. Data stays in its existing root during an update.
        </p>
      </div>
      {error ? <Card role="alert" className="border-[color-mix(in_srgb,var(--danger)_35%,var(--ui-border-subtle))] text-sm text-[var(--danger)]">{error}</Card> : null}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <Laptop className="size-7 text-[var(--primary)]" />
            <Badge tone={desktop?.kind === "available" ? "signal" : undefined}>
              {desktop?.kind === "available" ? "Update available" : desktop?.kind === "web" ? "Desktop app required" : "macOS desktop"}
            </Badge>
          </div>
          <div>
            <h3 className="font-semibold">Forge Desktop</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">
              {desktop?.kind === "available"
                ? `Version ${desktop.version} is signed and ready. Installed: ${desktop.currentVersion}.`
                : desktop?.kind === "current"
                  ? `Version ${desktop.currentVersion} is current.`
                  : desktop?.kind === "unconfigured"
                    ? `Version ${desktop.currentVersion} has no usable signed update channel.`
                    : "Open this page in the installed desktop app to check its signed update channel."}
            </p>
            {desktop?.kind === "available" && desktop.notes ? <p className="mt-2 line-clamp-4 text-xs text-[var(--ui-ink-faint)]">{desktop.notes}</p> : null}
            {desktop?.kind === "unconfigured" ? <p className="mt-2 text-xs text-[var(--ui-ink-faint)]">{desktop.message}</p> : null}
          </div>
          {progress ? (
            <div className="grid gap-2" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--ui-surface-3)]"><div className="h-full bg-[var(--primary)] transition-[width]" style={{ width: progress.total ? `${Math.min(100, progress.downloaded / progress.total * 100)}%` : "35%" }} /></div>
              <span className="text-xs text-[var(--ui-ink-faint)]">Downloaded {(progress.downloaded / 1_048_576).toFixed(1)} MiB{progress.total ? ` of ${(progress.total / 1_048_576).toFixed(1)} MiB` : ""}</span>
            </div>
          ) : null}
          <div className="mt-auto flex flex-wrap gap-2">
            <Button variant="secondary" pending={checking} pendingLabel="Checking…" onClick={() => void check()}><RefreshCw className="size-4" /> Check</Button>
            {desktop?.kind === "available" ? (
              <Button pending={installing} pendingLabel="Installing…" onClick={async () => { setInstalling(true); setError(null); try { await installDesktopUpdate(desktop.version, (downloaded, total) => setProgress({ downloaded, total })); } catch (caught) { setError(caught instanceof Error ? caught.message : "Forge could not install the update."); setInstalling(false); } }}><Download className="size-4" /> Install and restart</Button>
            ) : null}
          </div>
          <Link className="text-sm font-medium text-[var(--primary)]" to="/settings/data">Review data location and rollback <ExternalLink className="ml-1 inline size-3.5" /></Link>
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3"><Smartphone className="size-7 text-[var(--primary)]" /><Badge tone="signal">Release pipeline ready</Badge></div>
          <div><h3 className="font-semibold">iPhone and Apple Watch</h3><p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">Native pairing, protected approvals, Watch surfaces, screenshots, signed archive validation, TestFlight, and App Store submission lanes are source-owned. Apple credentials and review approval are still required to publish.</p></div>
          <div className="mt-auto flex items-center gap-2 text-sm text-[var(--success)]"><CheckCircle2 className="size-4" /> Forge does not claim App Store availability before Apple accepts it.</div>
        </Card>
        <Card className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3"><Smartphone className="size-7 text-[var(--primary)]" /><Badge tone="signal">Companion source ready</Badge></div>
          <div><h3 className="font-semibold">Android companion</h3><p className="mt-1 text-sm leading-6 text-[var(--ui-ink-medium)]">The Android companion supports QR pairing, explicit Health Connect permissions, an inspectable sync queue, and deliberate retry. Google Play signing and review remain publication gates.</p></div>
          <div className="mt-auto text-sm text-[var(--ui-ink-faint)]">No health category is selected or shared by default.</div>
        </Card>
      </div>
    </section>
  );
}
