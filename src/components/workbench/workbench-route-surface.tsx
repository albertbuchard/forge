import type { ReactNode } from "react";

export function WorkbenchRouteSurface({
  children
}: {
  surfaceId: string;
  children: ReactNode;
}) {
  return <>{children}</>;
}
