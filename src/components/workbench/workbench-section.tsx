import type { ReactNode } from "react";

export function WorkbenchSection({
  children
}: {
  boxId: string;
  surfaceId?: string | null;
  children: ReactNode;
}) {
  return <>{children}</>;
}
