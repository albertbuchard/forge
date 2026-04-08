import { Navigate, useParams } from "react-router-dom";

export function ConnectorDetailPage() {
  const params = useParams();
  const connectorId = params.connectorId ?? "";
  return <Navigate to={`/workbench/${connectorId}`} replace />;
}
