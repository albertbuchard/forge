import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { WorkbenchBox } from "@/components/workbench/workbench-provider";

export function WorkbenchRouteSurface({
  surfaceId,
  children
}: {
  surfaceId: string;
  children: ReactNode;
}) {
  const location = useLocation();
  return (
    <WorkbenchBox
      boxId={`surface:${surfaceId}:main`}
      surfaceId={surfaceId}
      routePath={location.pathname}
    >
      {children}
    </WorkbenchBox>
  );
}
