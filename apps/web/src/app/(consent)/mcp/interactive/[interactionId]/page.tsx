import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AgentApprovalView } from "@/components/agent-approval-view";
import { resolveCibaApprovalData } from "@/lib/agents/approval-resolve";
import { getAccountAssurance } from "@/lib/assurance/posture";
import { detectAuthMode, getFreshSession } from "@/lib/auth/session";

interface InteractionCopy {
  deniedDescription?: string;
  description?: string;
  requestedProfileFields?: string[];
  successDescription?: string;
  title?: string;
}

function buildInteractionCopy(input: {
  fields: string[];
  tool: string;
}): InteractionCopy {
  if (input.tool === "my_profile") {
    return {
      title: "Profile Access Request",
      description:
        "An application is requesting access to the selected profile fields. Vault-protected fields require an unlock before they can be released.",
      successDescription:
        "You approved the profile disclosure request. The requesting agent can now continue.",
      deniedDescription: "You denied the profile disclosure request.",
      requestedProfileFields: input.fields,
    };
  }

  if (input.tool === "purchase") {
    return {
      title: "Purchase Authorization",
      description:
        "An application is requesting approval to complete a purchase on your behalf.",
      successDescription:
        "You approved the purchase request. The requesting agent can now continue.",
      deniedDescription: "You denied the purchase request.",
    };
  }

  return {
    title: "Authorization Request",
  };
}

export default async function McpInteractivePage({
  params,
  searchParams,
}: {
  params: Promise<{ interactionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { interactionId } = await params;
  const resolvedSearchParams = await searchParams;
  const authReqId = resolvedSearchParams.authReqId;
  const tool = resolvedSearchParams.tool;
  const fieldsParam = resolvedSearchParams.fields;
  const fields =
    typeof fieldsParam === "string"
      ? fieldsParam.split(",").filter(Boolean)
      : [];

  if (typeof authReqId !== "string" || typeof tool !== "string") {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Invalid interaction link</p>
        </div>
      </div>
    );
  }

  const callbackPath = `/mcp/interactive/${encodeURIComponent(interactionId)}`;
  const callbackQuery = new URLSearchParams();
  callbackQuery.set("authReqId", authReqId);
  callbackQuery.set("tool", tool);
  if (fields.length > 0) {
    callbackQuery.set("fields", fields.join(","));
  }

  const session = await getFreshSession(await headers());

  if (!session?.user?.id) {
    redirect(
      `/sign-in?callbackURL=${encodeURIComponent(
        `${callbackPath}?${callbackQuery.toString()}`
      )}`
    );
  }

  const sessionAuthContextId =
    (session.session as { authContextId?: string | null }).authContextId ??
    null;

  if (!sessionAuthContextId) {
    redirect(
      `/sign-in?callbackURL=${encodeURIComponent(
        `${callbackPath}?${callbackQuery.toString()}`
      )}`
    );
  }

  const [detected, assurance, approval] = await Promise.all([
    detectAuthMode(session.user.id),
    getAccountAssurance(session.user.id),
    resolveCibaApprovalData(authReqId, session.user.id),
  ]);

  if (!approval) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-lg border p-6 text-center">
          <p className="text-muted-foreground">Request not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <AgentApprovalView
        agentIdentity={approval.agentIdentity}
        authMode={detected.authMode}
        authReqId={authReqId}
        initialRequest={approval.request}
        interactionCopy={buildInteractionCopy({ tool, fields })}
        registeredAgent={approval.registeredAgent}
        userTier={assurance.tier}
        wallet={detected.wallet}
      />
    </div>
  );
}
