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
  }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    label: place?.label ?? seed?.label ?? "",
    latitude: String(place?.latitude ?? seed?.latitude ?? ""),
    longitude: String(place?.longitude ?? seed?.longitude ?? ""),
    radiusMeters: String(place?.radiusMeters ?? seed?.radiusMeters ?? 100),
    categoryTags: (place?.categoryTags ?? seed?.categoryTags ?? []).join(", ")
  });

  useEffect(() => {
    setDraft({
      label: place?.label ?? seed?.label ?? "",
      latitude: String(place?.latitude ?? seed?.latitude ?? ""),
      longitude: String(place?.longitude ?? seed?.longitude ?? ""),
      radiusMeters: String(place?.radiusMeters ?? seed?.radiusMeters ?? 100),
      categoryTags: (place?.categoryTags ?? seed?.categoryTags ?? []).join(", ")
    });
  }, [place, seed]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
                className="rounded-full border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)] p-2 text-[var(--ui-ink-soft)] transition hover:bg-[var(--ui-surface-hover)] hover:text-[var(--ui-ink-strong)]"
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
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="border border-[var(--ui-border-subtle)] bg-[var(--ui-surface-1)]"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                void onSave({
                  id: place?.id,
                  label: draft.label,
                  latitude: Number(draft.latitude),
                  longitude: Number(draft.longitude),
                  radiusMeters: Number(draft.radiusMeters),
                  categoryTags: draft.categoryTags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                }).then(() => onOpenChange(false))
              }
            >
              Save place
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
