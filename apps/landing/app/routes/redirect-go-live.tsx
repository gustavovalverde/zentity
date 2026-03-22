import { Navigate } from "react-router";

export default function GoLiveRedirect() {
  return <Navigate to="/docs/oauth-integrations" replace />;
}
