import { LifeForceOverviewWorkspace } from "@/components/life-force/life-force-workspace";
import { UserScopeSelector, useForgeShell } from "@/components/shell/app-shell";
import { PageHero } from "@/components/shell/page-hero";

export function LifeForcePage() {
  const shell = useForgeShell();
  const lifeForce = shell.snapshot.lifeForce;

  if (!lifeForce) {
    return (
      <div className="grid gap-4">
        <PageHero
          title="Life Force"
          titleText="Life Force"
          description="Action Point capacity, weekday curves, and instant headroom editing live here."
          badge="Not calibrated yet"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <PageHero
        title="Life Force"
        titleText="Life Force"
        description="Edit weekday Action Point curves, inspect drains, and tune the capacity model without crowding the Overview surface."
        badge={`${Math.round(lifeForce.spentTodayAp)} / ${Math.round(lifeForce.dailyBudgetAp)} AP`}
        actions={
          <UserScopeSelector
            users={shell.snapshot.users}
            selectedUserIds={shell.selectedUserIds}
            onChange={shell.setSelectedUserIds}
          />
        }
      />
      <LifeForceOverviewWorkspace
        selectedUserIds={shell.selectedUserIds}
        fallbackLifeForce={lifeForce}
        onRefresh={shell.refresh}
        showEditor
      />
    </div>
  );
}
