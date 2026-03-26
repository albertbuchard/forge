import { create } from "zustand";

interface CommandCenterState {
  selectedOwner: string | null;
  selectedGoalId: string | null;
  selectedTagIds: string[];
  setOwner: (owner: string | null) => void;
  setGoal: (goalId: string | null) => void;
  toggleTag: (tagId: string) => void;
  reset: () => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  selectedOwner: null,
  selectedGoalId: null,
  selectedTagIds: [],
  setOwner: (selectedOwner) => set({ selectedOwner }),
  setGoal: (selectedGoalId) => set({ selectedGoalId }),
  toggleTag: (tagId) =>
    set((state) => ({
      selectedTagIds: state.selectedTagIds.includes(tagId)
        ? state.selectedTagIds.filter((entry) => entry !== tagId)
        : [...state.selectedTagIds, tagId]
    })),
  reset: () =>
    set({
      selectedOwner: null,
      selectedGoalId: null,
      selectedTagIds: []
    })
}));
