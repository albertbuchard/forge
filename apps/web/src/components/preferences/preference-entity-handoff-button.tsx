import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { enqueuePreferenceEntity } from "@/lib/api";
import { describeApiError } from "@/lib/api-error";
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
        throw new Error(
          "Select a single owner before sending entities to Preferences."
        );
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

  const error = handoffMutation.error
    ? describeApiError(handoffMutation.error).description
    : null;

  return (
    <div className="grid gap-2">
      <Button
        variant="secondary"
        size={size}
        disabled={!userId}
        pending={handoffMutation.isPending}
        pendingLabel="Sending to Preferences"
        aria-describedby={
          error ? `preference-handoff-error-${entityId}` : undefined
        }
        onClick={() => handoffMutation.mutate()}
        title={
          userId
            ? `Link this ${entityType} to the ${domain} preference queue without duplicating its identity.`
            : "Select a single user scope before sending entities to Preferences."
        }
      >
        <Compass className="size-4" />
        Send to Preferences
      </Button>
      {error ? (
        <div
          id={`preference-handoff-error-${entityId}`}
          role="alert"
          className="max-w-sm text-sm text-[var(--danger)]"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
