import { create } from "zustand";

interface CommandCenterState {
  selectedUserId: string | null;
  selectedGoalId: string | null;
  selectedTagIds: string[];
  setUserId: (userId: string | null) => void;
  setGoal: (goalId: string | null) => void;
  toggleTag: (tagId: string) => void;
  reset: () => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set) => ({
  selectedUserId: null,
  selectedGoalId: null,
  selectedTagIds: [],
  setUserId: (selectedUserId) => set({ selectedUserId }),
  setGoal: (selectedGoalId) => set({ selectedGoalId }),
  toggleTag: (tagId) =>
    set((state) => ({
      selectedTagIds: state.selectedTagIds.includes(tagId)
        ? state.selectedTagIds.filter((entry) => entry !== tagId)
        : [...state.selectedTagIds, tagId]
    })),
  reset: () =>
    set({
      selectedUserId: null,
      selectedGoalId: null,
      selectedTagIds: []
    })
}));
