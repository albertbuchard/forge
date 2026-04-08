import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WorkbenchBox } from "@/components/workbench/workbench-provider";

export function WorkbenchSection({
  boxId,
  surfaceId = null,
  children
}: {
  boxId: string;
  surfaceId?: string | null;
  children: ReactNode;
}) {
  const location = useLocation();
  return (
    <WorkbenchBox
      boxId={boxId}
      surfaceId={surfaceId}
      routePath={location.pathname}
    >
      {children}
    </WorkbenchBox>
  );
}
