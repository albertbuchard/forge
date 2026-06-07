import type { ReactNode } from "react";

export function WorkbenchBox({
  children
}: {
  children: ReactNode;
  boxId?: string;
  surfaceId?: string | null;
  routePath?: string | null;
}) {
  return <>{children}</>;
}
