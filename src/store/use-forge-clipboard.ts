import { create } from "zustand";
import type { CalendarAvailability, CrudEntityType } from "@/lib/types";

export type ForgeClipboardEntityRef = {
  type: "entity_ref";
  entityType: CrudEntityType;
  entityId: string;
  label?: string;
};

export type ForgeClipboardTextItem = {
  type: "text";
  text: string;
};

export type ForgeClipboardCalendarEventItem = {
  type: "calendar_event";
  eventId: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  timezone: string;
  availability: CalendarAvailability;
  preferredCalendarId: string | null;
  categories: string[];
  links: Array<{
    entityType: CrudEntityType;
    entityId: string;
    relationshipType: string;
  }>;
};

export type ForgeClipboardItem =
  | ForgeClipboardEntityRef
  | ForgeClipboardTextItem
  | ForgeClipboardCalendarEventItem;

export type ForgeClipboardEntry = {
  id: string;
  mode: "copy" | "cut";
  source: "calendar" | "notes" | "entities" | "text";
  label: string;
  createdAt: string;
  items: ForgeClipboardItem[];
};

type ForgeClipboardState = {
  entry: ForgeClipboardEntry | null;
  setEntry: (entry: ForgeClipboardEntry) => void;
  clear: () => void;
  completePaste: () => void;
};

export const useForgeClipboardStore = create<ForgeClipboardState>((set) => ({
  entry: null,
  setEntry: (entry) => set({ entry }),
  clear: () => set({ entry: null }),
  completePaste: () =>
    set((state) => ({
      entry: state.entry?.mode === "cut" ? null : state.entry
    }))
}));
