import { PageHeader } from "@/components/layouts/page-header";

import { AgentsDashboardClient } from "./_components/agents-dashboard-client";

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        description="Manage registered agents, their capability grants, and usage."
        title="Agents"
      />
      <AgentsDashboardClient />
    </div>
  );
}
