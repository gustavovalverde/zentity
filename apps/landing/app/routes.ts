import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("agents", "routes/agents.tsx"),
  route("capabilities", "routes/capabilities.tsx"),
  route("whitepaper", "routes/whitepaper.tsx"),
  route("zk-auth", "routes/zk-auth.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
  route("docs/*", "routes/docs.tsx"),
  route("api/search", "routes/search.ts"),
  route("compliance", "routes/redirect-compliance.tsx"),
  route("interoperability", "routes/redirect-interoperability.tsx"),
  route("go-live", "routes/redirect-go-live.tsx"),
] satisfies RouteConfig;
