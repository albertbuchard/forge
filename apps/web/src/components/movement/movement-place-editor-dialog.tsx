import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MovementKnownPlace } from "@/lib/types";

export type MovementPlaceDraftSeed = {
  label?: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  categoryTags?: string[];
};

export function MovementPlaceEditorDialog({
  open,
  onOpenChange,
  place,
  seed,
  onSave
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: MovementKnownPlace | null;
  seed?: MovementPlaceDraftSeed | null;
  onSave: (input: {
    id?: string;
    label: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    categoryTags: string[];
    visibility: "personal" | "shared";
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    label: place?.label ?? seed?.label ?? "",
    latitude: String(place?.latitude ?? seed?.latitude ?? ""),
    longitude: String(place?.longitude ?? seed?.longitude ?? ""),
    radiusMeters: String(place?.radiusMeters ?? seed?.radiusMeters ?? 100),
    categoryTags: (place?.categoryTags ?? seed?.categoryTags ?? []).join(", "),
    visibility: place?.visibility ?? ("shared" as const)
  });
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      label: place?.label ?? seed?.label ?? "",
      latitude: String(place?.latitude ?? seed?.latitude ?? ""),
      longitude: String(place?.longitude ?? seed?.longitude ?? ""),
      radiusMeters: String(place?.radiusMeters ?? seed?.radiusMeters ?? 100),
      categoryTags: (place?.categoryTags ?? seed?.categoryTags ?? []).join(", "),
      visibility: place?.visibility ?? ("shared" as const)
    });
    setSaveError(null);
  }, [open, place, seed]);

  const savePlace = async () => {
    setSavePending(true);
    setSaveError(null);
    try {
      await onSave({
        id: place?.id,
        label: draft.label,
        latitude: Number(draft.latitude),
        longitude: Number(draft.longitude),
        radiusMeters: Number(draft.radiusMeters),
        categoryTags: draft.categoryTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        visibility: draft.visibility
      });
      onOpenChange(false);
    } catch {
      setSaveError("Place changes could not be saved. Review the fields and try again.");
    } finally {
      setSavePending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!savePending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--ui-overlay-backdrop)] backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[8vh] z-50 w-[min(32rem,calc(100vw-1.25rem))] -translate-x-1/2 rounded-[30px] border border-[var(--ui-border-subtle)] bg-[image:var(--ui-surface-modal)] p-5 shadow-[var(--ui-shadow-floating)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="font-display text-[1.3rem] tracking-normal text-[var(--ui-ink-strong)]">
                {place ? `Edit ${place.label}` : "New known place"}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--ui-ink-soft)]">
                Define life landmarks once so the companion and web views can reason about stays and trips consistently.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close place editor"
                disabled={savePending}
                className="flex size-11 items-center justify-center rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="size-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-5 grid gap-3">
            <Input
              value={draft.label}
              onChange={(event) =>
                setDraft((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="Home, Main Office, Riverside path..."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={draft.latitude}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    latitude: event.target.value
                  }))
                }
                placeholder="Latitude"
              />
              <Input
                value={draft.longitude}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    longitude: event.target.value
                  }))
                }
                placeholder="Longitude"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Input
                value={draft.radiusMeters}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    radiusMeters: event.target.value
                  }))
                }
                placeholder="Radius meters"
              />
              <Input
                value={draft.categoryTags}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    categoryTags: event.target.value
                  }))
                }
                placeholder="home, gym, holiday, parents-house"
              />
            </div>
            <fieldset className="grid gap-2 rounded-[18px] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-2)] p-3">
              <legend className="px-1 text-sm font-semibold text-[var(--ui-ink-strong)]">
                Location visibility
              </legend>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]">
                <input
                  type="radio"
                  name="movement-place-visibility"
                  value="personal"
                  checked={draft.visibility === "personal"}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      visibility: "personal"
                    }))
                  }
                  className="size-4 accent-[var(--primary)]"
                />
                <span>
                  <strong className="text-[var(--ui-ink-strong)]">Personal</strong>
                  <span className="ml-1 text-[var(--ui-ink-muted)]">
                    Hide exact coordinates on the Movement overview.
                  </span>
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-2 text-sm text-[var(--ui-ink-medium)] hover:bg-[var(--ui-surface-hover)]">
                <input
                  type="radio"
                  name="movement-place-visibility"
                  value="shared"
                  checked={draft.visibility === "shared"}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      visibility: "shared"
                    }))
                  }
                  className="size-4 accent-[var(--primary)]"
                />
                <span>
                  <strong className="text-[var(--ui-ink-strong)]">Shared</strong>
                  <span className="ml-1 text-[var(--ui-ink-muted)]">
                    Show exact coordinates on the Movement overview.
                  </span>
                </span>
              </label>
            </fieldset>
            {saveError ? (
              <div role="alert" className="text-sm text-[var(--danger)]">
                {saveError}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={savePending}
              onClick={() => onOpenChange(false)}
              className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
            >
              Cancel
            </Button>
            <Button
              pending={savePending}
              pendingLabel="Saving place"
              onClick={() => void savePlace()}
            >
              Save place
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
