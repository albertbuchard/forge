import { Navigate, useSearchParams } from "react-router-dom";

export function ConnectorsPage() {
  const [searchParams] = useSearchParams();
  const preferredSurface = searchParams.get("surface");
  const suffix = preferredSurface
    ? `?surface=${encodeURIComponent(preferredSurface)}`
    : "";
  return <Navigate to={`/workbench${suffix}`} replace />;
}
