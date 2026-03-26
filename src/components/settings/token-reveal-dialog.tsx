import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentOnboardingPayload } from "@/lib/types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback: select text
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-white/65 transition hover:bg-white/[0.12] hover:text-white"
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ label, children, copyText }: { label: string; children: string; copyText?: string }) {
  return (
    <div className="rounded-[18px] bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.14em] text-white/40">{label}</div>
        <CopyButton text={copyText ?? children} />
      </div>
      <pre className="mt-3 overflow-x-auto rounded-[14px] bg-[rgba(8,13,28,0.78)] p-3 text-xs leading-6 text-white/78">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export type TokenRevealState = {
  tokenString: string;
  agentLabel: string;
  onboarding: AgentOnboardingPayload;
};

export function TokenRevealDialog({
  open,
  onOpenChange,
  state
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TokenRevealState | null;
}) {
  if (!state) return null;

  const { tokenString, agentLabel, onboarding } = state;

  const configSnippet = JSON.stringify(
    {
      baseUrl: onboarding.forgeBaseUrl,
      apiToken: tokenString,
      actorLabel: agentLabel,
      timeoutMs: onboarding.defaultTimeoutMs
    },
    null,
    2
  );

  const curlVerification = [
    `curl -s ${onboarding.healthUrl} \\`,
    `  -H "Authorization: Bearer ${tokenString}" \\`,
    `  -H "X-Forge-Source: agent" \\`,
    `  -H "X-Forge-Actor: ${agentLabel}"`
  ].join("\n");

  const restartSnippet = ["openclaw gateway restart", `openclaw agent --message "forge_get_operator_overview"`].join("\n");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.82)] backdrop-blur-xl" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(52rem,calc(100vh-1rem))] w-[min(52rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[34px] border border-[rgba(192,193,255,0.14)] bg-[linear-gradient(180deg,rgba(21,28,44,0.99),rgba(12,17,30,0.99))] shadow-[0_30px_90px_rgba(3,8,18,0.55)]">
          <Dialog.Title className="sr-only">Token issued — setup instructions</Dialog.Title>
          <Dialog.Description className="sr-only">Your new agent token has been issued. Copy it now and follow the setup guide.</Dialog.Description>

          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(192,193,255,0.12)]">
                <KeyRound className="size-5 text-[rgba(192,193,255,0.85)]" />
              </div>
              <div>
                <div className="font-label text-[11px] uppercase tracking-[0.18em] text-white/42">Token issued</div>
                <div className="mt-0.5 font-display text-xl text-white">Save your token now</div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="rounded-full bg-white/6 p-2 text-white/55 transition hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="grid gap-5"
            >
              {/* One-time token reveal */}
              <div className="rounded-[20px] border border-amber-400/18 bg-amber-400/[0.07] p-4">
                <div className="flex items-center gap-2">
                  <Badge className="text-amber-300">One-time reveal</Badge>
                  <span className="text-sm text-white/60">This value will not be shown again.</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-[14px] bg-[rgba(8,13,28,0.78)] px-4 py-3">
                  <code className="min-w-0 flex-1 break-all text-xs text-white/90">{tokenString}</code>
                  <CopyButton text={tokenString} />
                </div>
                <div className="mt-2 text-xs text-white/45">
                  Forge stores only a hash — the raw token is unrecoverable after you close this dialog. If lost, rotate the token from the Agents settings page.
                </div>
              </div>

              {/* Step 1 — add to plugin config */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-5 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white">1</div>
                  <span className="text-sm font-medium text-white">Add the token to your OpenClaw plugin config</span>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm leading-6 text-white/62">
                  Open your <code className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs text-white/82">openclaw.json</code> file and find the{" "}
                  <code className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs text-white/82">forge</code> plugin entry under{" "}
                  <code className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs text-white/82">plugins</code>. Add or replace its{" "}
                  <code className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs text-white/82">params</code> with the config block below.
                </div>
                <div className="mt-3">
                  <CodeBlock label="Plugin params — paste into openclaw.json → plugins → forge → params" copyText={configSnippet}>
                    {configSnippet}
                  </CodeBlock>
                </div>
              </div>

              {/* Step 2 — restart gateway */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-5 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white">2</div>
                  <span className="text-sm font-medium text-white">Restart the gateway and confirm the agent can connect</span>
                </div>
                <CodeBlock label="Run in terminal" copyText={restartSnippet}>
                  {restartSnippet}
                </CodeBlock>
              </div>

              {/* Step 3 — verify */}
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex size-5 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white">3</div>
                  <span className="text-sm font-medium text-white">Verify the token is accepted by the API</span>
                </div>
                <div className="rounded-[18px] bg-white/[0.04] p-4 text-sm leading-6 text-white/62">
                  Run the curl below. A{" "}
                  <code className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-xs text-emerald-300">200 OK</code> response means the token works and the agent{" "}
                  <strong className="text-white/80">{agentLabel}</strong> is authenticated.
                </div>
                <div className="mt-3">
                  <CodeBlock label="Verify token — run in terminal" copyText={curlVerification}>
                    {curlVerification}
                  </CodeBlock>
                </div>
              </div>

              {/* Tip */}
              <div className="rounded-[18px] border border-white/6 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-white/50">
                <strong className="text-white/68">Tip:</strong> If you ever lose this token, go to <strong className="text-white/68">Settings → Agents → Agent tokens</strong>, find the entry, and click{" "}
                <strong className="text-white/68">Rotate &amp; reveal</strong> to get a fresh value without creating a new agent identity.
              </div>
            </motion.div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-white/8 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-white/45">Token saved? Close this dialog when you are ready.</div>
              <Button onClick={() => onOpenChange(false)}>
                <Check className="size-4" />
                Done
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
