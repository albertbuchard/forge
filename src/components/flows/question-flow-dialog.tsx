import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, InfoTooltip } from "@/components/ui/info-tooltip";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 1023px)";

export type QuestionFlowStep<TValue> = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  render: (
    value: TValue,
    setValue: (patch: Partial<TValue>) => void
  ) => ReactNode;
};

type QuestionFlowStepIndexResolution = {
  open: boolean;
  wasOpen: boolean;
  initialStepId?: string;
  previousInitialStepId?: string;
  currentStepIndex: number;
  steps: Array<{ id: string }>;
};

export function resolveQuestionFlowStepIndex({
  open,
  wasOpen,
  initialStepId,
  previousInitialStepId,
  currentStepIndex,
  steps
}: QuestionFlowStepIndexResolution) {
  if (!open) {
    return 0;
  }

  const resolveInitialIndex = () => {
    if (!initialStepId) {
      return 0;
    }
    const nextIndex = steps.findIndex((candidate) => candidate.id === initialStepId);
    return nextIndex >= 0 ? nextIndex : 0;
  };

  const initialStepChanged = previousInitialStepId !== initialStepId;

  if (!wasOpen || initialStepChanged) {
    return resolveInitialIndex();
  }

  if (steps.length === 0) {
    return 0;
  }

  if (currentStepIndex >= steps.length) {
    return Math.max(0, steps.length - 1);
  }

  if (currentStepIndex < 0) {
    return 0;
  }

  return currentStepIndex;
}

function renderDialogMessageBlock(message: string) {
  const sections = message
    .split(/\n\s*\n/g)
    .map((section) =>
      section
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
    .filter((section) => section.length > 0);

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      {sections.map((section, sectionIndex) => {
        const bulletLines = section.filter((line) => line.startsWith("- "));
        const bodyLines = section.filter((line) => !line.startsWith("- "));

        return (
          <div key={`section-${sectionIndex}`} className="grid gap-2">
            {bodyLines.map((line, index) => (
              <p key={`${sectionIndex}-${line}-${index}`}>{line}</p>
            ))}
            {bulletLines.length > 0 ? (
              <ul className="grid list-disc gap-1 pl-5">
                {bulletLines.map((line, index) => (
                  <li key={`${sectionIndex}-${line}-${index}`}>
                    {line.slice(2)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function useIsMobileFlow() {
  const [isMobile, setIsMobile] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return false;
    }
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const updateMatch = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateMatch);
      return () => mediaQuery.removeEventListener("change", updateMatch);
    }

    mediaQuery.addListener(updateMatch);
    return () => mediaQuery.removeListener(updateMatch);
  }, []);

  return isMobile;
}

export function FlowField({
  label,
  description,
  labelHelp,
  hint,
  error,
  children
}: {
  label: string;
  description?: string;
  labelHelp?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="flex items-center gap-2 text-sm font-medium text-white">
        <span>{label}</span>
        {labelHelp ? (
          <InfoTooltip content={labelHelp} label={`Explain ${label}`} />
        ) : null}
      </span>
      {description ? (
        <span className="text-sm leading-6 text-white/54">{description}</span>
      ) : null}
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      {error ? <span className="text-sm text-rose-300">{error}</span> : null}
    </label>
  );
}

export function FlowChoiceGrid({
  options,
  value,
  onChange,
  columns = 2
}: {
  options: Array<{ value: string; label: string; description?: string }>;
  value: string;
  onChange: (value: string) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "rounded-[22px] border px-4 py-4 text-left transition",
              selected
                ? "border-[rgba(192,193,255,0.28)] bg-[rgba(192,193,255,0.14)] text-white shadow-[0_18px_36px_rgba(5,12,24,0.24)]"
                : "border-white/8 bg-white/[0.04] text-white/72 hover:bg-white/[0.07]"
            )}
            onClick={() => onChange(option.value)}
          >
            <div className="font-medium">{option.label}</div>
            {option.description ? (
              <div className="mt-2 text-sm leading-6 text-white/54">
                {option.description}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function QuestionFlowDialog<TValue>({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  value,
  onChange,
  steps,
  onSubmit,
  submitLabel,
  pending = false,
  pendingLabel,
  error,
  resolveError,
  initialStepId,
  contentClassName
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eyebrow: string;
  title: string;
  description: string;
  value: TValue;
  onChange: (value: TValue) => void;
  steps: Array<QuestionFlowStep<TValue>>;
  onSubmit: () => Promise<void>;
  submitLabel: string;
  pending?: boolean;
  pendingLabel?: string;
  error?: string | null;
  resolveError?: (stepId: string) => string | null | undefined;
  initialStepId?: string;
  contentClassName?: string;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobileFlow();
  const [stepIndex, setStepIndex] = useState(0);
  const previousOpenRef = useRef(open);
  const previousInitialStepIdRef = useRef(initialStepId);
  const step = steps[stepIndex];

  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    const previousInitialStepId = previousInitialStepIdRef.current;
    const nextStepIndex = resolveQuestionFlowStepIndex({
      open,
      wasOpen,
      initialStepId,
      previousInitialStepId,
      currentStepIndex: stepIndex,
      steps
    });

    previousOpenRef.current = open;
    previousInitialStepIdRef.current = initialStepId;

    if (nextStepIndex !== stepIndex) {
      setStepIndex(nextStepIndex);
    }
  }, [initialStepId, open, stepIndex, steps]);

  const setValue = (patch: Partial<TValue>) => {
    onChange({ ...value, ...patch });
  };

  const totalSteps = steps.length;
  const progress = totalSteps === 0 ? 0 : ((stepIndex + 1) / totalSteps) * 100;
  const resolvedError = step ? resolveError?.(step.id) : undefined;
  const visibleError = resolvedError === undefined ? error : resolvedError;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(4,8,18,0.72)] backdrop-blur-xl" />
        <Dialog.Content
          data-testid="question-flow-dialog"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-white/8 bg-[linear-gradient(180deg,rgba(21,28,44,0.985),rgba(12,17,30,0.985))] shadow-[0_30px_90px_rgba(3,8,18,0.45)]",
            isMobile
              ? "inset-x-3 bottom-3 top-4 rounded-[30px]"
              : "left-1/2 top-1/2 h-[min(52rem,calc(100vh-1rem))] w-[min(56rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-[34px]",
            contentClassName
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {description}
          </Dialog.Description>

          <div className="sticky top-0 z-10 border-b border-white/8 bg-[rgba(12,17,30,0.9)] px-4 py-2.5 backdrop-blur-xl md:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-white/42">
                  <span className="truncate">{eyebrow}</span>
                  <span className="whitespace-nowrap">
                    Step {stepIndex + 1} of {totalSteps}
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full bg-[linear-gradient(90deg,rgba(192,193,255,0.9),rgba(125,211,252,0.82))]"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  />
                </div>
              </div>
              <Dialog.Close asChild>
                <ModalCloseButton aria-label={t("common.dialogs.closeDialog")} />
              </Dialog.Close>
            </div>
          </div>

          <div
            data-testid="question-flow-canvas"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="flex min-h-full min-w-0 flex-col gap-5"
              >
                <div className="flex min-h-full min-w-0 flex-col justify-start">
                  {step.eyebrow ? (
                    <div className="font-label text-[11px] uppercase tracking-[0.18em] text-[var(--secondary)]">
                      {step.eyebrow}
                    </div>
                  ) : null}
                  <h3 className="mt-1.5 font-display text-[clamp(1.45rem,2.15vw,2rem)] leading-tight text-white">
                    {step.title}
                  </h3>
                  {step.description ? (
                    <p className="mt-1.5 max-w-3xl text-sm leading-6 text-white/58">
                      {step.description}
                    </p>
                  ) : null}
                  {visibleError ? (
                    <div className="mt-4 rounded-[20px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
                      {renderDialogMessageBlock(visibleError)}
                    </div>
                  ) : null}
                  <div className="mt-5 grid flex-1 content-start gap-5">
                    {step.render(value, setValue)}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="sticky bottom-0 border-t border-white/8 bg-[rgba(12,17,30,0.92)] px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl md:px-6 md:pb-3">
            <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-between">
              <div className="hidden min-w-0 shrink text-[12px] text-white/45 sm:block">
                <span className="truncate whitespace-nowrap">
                  Step {stepIndex + 1}/{totalSteps}
                </span>
              </div>
              <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                {stepIndex > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-w-max px-3 text-[12px]"
                    onClick={() =>
                      setStepIndex((current) => Math.max(0, current - 1))
                    }
                  >
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                ) : (
                  <Dialog.Close asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-w-max px-3 text-[12px]"
                    >
                      {t("common.actions.cancel")}
                    </Button>
                  </Dialog.Close>
                )}
                {stepIndex < totalSteps - 1 ? (
                  <Button
                    type="button"
                    className="min-w-max px-3 text-[12px]"
                    onClick={() =>
                      setStepIndex((current) =>
                        Math.min(totalSteps - 1, current + 1)
                      )
                    }
                  >
                    Continue
                    <ArrowRight className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="min-w-max px-3 text-[12px]"
                    pending={pending}
                    pendingLabel={pendingLabel}
                    onClick={() => void onSubmit()}
                  >
                    <Check className="size-4" />
                    {submitLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
