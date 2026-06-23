import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { enqueuePreferenceEntity } from "@/lib/api";
import type { CrudEntityType, PreferenceDomain } from "@/lib/types";

export function PreferenceEntityHandoffButton({
  userId,
  domain,
  entityType,
  entityId,
  label,
  description,
  tags,
  size = "sm"
}: {
  userId: string | null;
  domain: PreferenceDomain;
  entityType: CrudEntityType;
  entityId: string;
  label?: string;
  description?: string;
  tags?: string[];
  size?: "sm" | "md" | "lg";
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const handoffMutation = useMutation({
    mutationFn: async () => {
      if (!userId) {
        throw new Error("Select a single owner before sending entities to Preferences.");
      }
      return enqueuePreferenceEntity({
        userId,
        domain,
        entityType,
        entityId,
        label,
        description,
        tags
      });
    },
    onSuccess: async ({ item }) => {
      await queryClient.invalidateQueries({ queryKey: ["forge-preferences"] });
      navigate(
        `/preferences?userId=${encodeURIComponent(userId ?? "")}&domain=${encodeURIComponent(domain)}&focusItem=${encodeURIComponent(item.id)}`
      );
    }
  });

  return (
    <Button
      variant="secondary"
      size={size}
      disabled={!userId}
      pending={handoffMutation.isPending}
      pendingLabel="Sending to Preferences"
      onClick={() => void handoffMutation.mutateAsync()}
      title={
        userId
          ? "Add this entity to the Preferences compare queue."
          : "Select a single user scope before sending entities to Preferences."
      }
    >
      <Compass className="size-4" />
      Send to Preferences
    </Button>
  );
}
