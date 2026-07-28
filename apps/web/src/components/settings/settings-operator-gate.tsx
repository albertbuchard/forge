import type { ReactNode } from "react";
import { SurfaceSkeleton } from "@/components/experience/surface-skeleton";
import { SettingsOwnerBoundary } from "@/components/settings/settings-owner-boundary";
import { SettingsStateFrame } from "@/components/settings/settings-section-nav";
import { ErrorState } from "@/components/ui/page-state";
import { useGetOperatorSessionQuery } from "@/store/api/forge-api";

export function SettingsOperatorGate({
  children
}: {
  children: ReactNode;
}) {
  const operatorSessionQuery = useGetOperatorSessionQuery();

  if (
    operatorSessionQuery.isLoading ||
    (!operatorSessionQuery.data && !operatorSessionQuery.isError)
  ) {
    return (
      <SettingsStateFrame>
        <div role="status" aria-live="polite">
          <span className="sr-only">Checking settings access</span>
          <SurfaceSkeleton
            eyebrow="Settings"
            title="Checking settings access"
            description="Verifying whether this browser has local-owner authority."
            columns={1}
            blocks={3}
          />
        </div>
      </SettingsStateFrame>
    );
  }

  if (operatorSessionQuery.isError) {
    return (
      <SettingsStateFrame>
        <ErrorState
          eyebrow="Settings"
          error={operatorSessionQuery.error}
          onRetry={operatorSessionQuery.refetch}
        />
      </SettingsStateFrame>
    );
  }

  if (
    !operatorSessionQuery.data.session.localOwner ||
    operatorSessionQuery.data.session.principalKind !== "operator_session" ||
    operatorSessionQuery.data.session.profile !== "operator"
  ) {
    return (
      <SettingsOwnerBoundary
        title="Settings stay on the Forge host"
        description="Your paired browser can use Forge normally, while account, integration, companion, data, model, agent, reward, and diagnostic settings remain under local-owner control."
      />
    );
  }

  return children;
}
