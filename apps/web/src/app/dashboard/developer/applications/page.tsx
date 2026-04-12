"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/chrome/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient, useSession } from "@/lib/auth/auth-client";

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface OwnedClient {
  clientId: string;
  createdAt: number;
  disabled: boolean;
  name: string | null;
  redirectUris: string[] | string;
  scopes: string[] | string | null;
}

interface UnownedClient {
  clientId: string;
  createdAt: number;
  name: string | null;
  redirectUris: string[] | string;
  scopes: string[] | string | null;
}

function normalizeStringArray(value: string[] | string | null): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Not valid JSON — treat as single-element array
  }
  return [value];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

async function fetchOrganizations(): Promise<Org[]> {
  const result = await authClient.organization.list();
  if (result.error) {
    throw new Error(result.error.message || "Failed to list organizations");
  }
  return (result.data ?? []) as Org[];
}

async function fetchOwnedClients(): Promise<OwnedClient[]> {
  const response = await fetch("/api/rp-admin/clients/owned");
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { clients: OwnedClient[] };
  return body.clients ?? [];
}

async function fetchUnownedClients(): Promise<UnownedClient[]> {
  const response = await fetch("/api/rp-admin/clients/unowned");
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || "Failed to fetch clients");
  }
  const body = (await response.json()) as { clients: UnownedClient[] };
  return body.clients ?? [];
}

function ClientCard({
  clientId,
  name,
  scopes,
  redirectUris,
  disabled,
  action,
}: {
  clientId: string;
  name: string | null;
  scopes: string[] | string | null;
  redirectUris: string[] | string;
  disabled?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{name || "Unnamed client"}</div>
          <div className="font-mono text-muted-foreground text-xs">
            {clientId}
          </div>
        </div>
        {disabled && (
          <span className="rounded bg-destructive/10 px-2 py-0.5 font-medium text-destructive text-xs">
            Disabled
          </span>
        )}
        {action}
      </div>
      {scopes != null && (
        <div className="text-muted-foreground text-xs">
          Scopes:{" "}
          <span className="font-mono">
            {normalizeStringArray(scopes).join(", ")}
          </span>
        </div>
      )}
      <div className="text-muted-foreground text-xs">
        Redirect URIs:{" "}
        <span className="font-mono">
          {normalizeStringArray(redirectUris).join(", ")}
        </span>
      </div>
    </div>
  );
}

function OwnedClientsContent({
  activeOrgId,
  loading,
  clients,
}: {
  activeOrgId: string | null;
  loading: boolean;
  clients: OwnedClient[];
}) {
  if (!activeOrgId) {
    return (
      <p className="text-muted-foreground text-sm">
        Set an active organization to view its clients.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner /> Loading…
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No clients assigned to this organization yet. Clients register via
          Dynamic Client Registration (DCR) and appear in &ldquo;Pending
          Registrations&rdquo; below.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {clients.map((c) => (
        <ClientCard
          clientId={c.clientId}
          disabled={c.disabled}
          key={c.clientId}
          name={c.name}
          redirectUris={c.redirectUris}
          scopes={c.scopes}
        />
      ))}
    </div>
  );
}

export default function ApplicationsPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const activeOrgId = session?.session?.activeOrganizationId ?? null;
  const queryClient = useQueryClient();

  const [newOrgName, setNewOrgName] = useState("");
  const newOrgSlug = useMemo(() => slugify(newOrgName) || "", [newOrgName]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const sessionReady = !sessionPending && !!session;
  const clientsEnabled = sessionReady && !!activeOrgId;

  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: fetchOrganizations,
    enabled: sessionReady,
  });

  const ownedQuery = useQuery({
    queryKey: ["rp-admin", "clients", "owned"],
    queryFn: fetchOwnedClients,
    enabled: clientsEnabled,
  });

  const unownedQuery = useQuery({
    queryKey: ["rp-admin", "clients", "unowned"],
    queryFn: fetchUnownedClients,
    enabled: clientsEnabled,
  });

  const createOrgMutation = useMutation({
    mutationFn: async ({ name, slug }: { name: string; slug: string }) => {
      const result = await authClient.organization.create({ name, slug });
      if (result.error) {
        throw new Error(
          result.error.message || "Failed to create organization"
        );
      }
    },
    onSuccess: () => {
      setNewOrgName("");
      setActionOk("Organization created.");
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      globalThis.window.location.reload();
    },
    onError: (err) => {
      setActionError(
        err instanceof Error ? err.message : "Failed to create organization"
      );
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: async (organizationId: string) => {
      const result = await authClient.organization.setActive({
        organizationId,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to set active org");
      }
    },
    onSuccess: () => {
      setActionOk("Active organization updated.");
      globalThis.window.location.reload();
    },
    onError: (err) => {
      setActionError(
        err instanceof Error ? err.message : "Failed to set active org"
      );
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const response = await fetch("/api/rp-admin/clients/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, force: false }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Failed to approve client");
      }
    },
    onSuccess: () => {
      setActionOk("Client assigned to active organization.");
      queryClient.invalidateQueries({ queryKey: ["rp-admin", "clients"] });
    },
    onError: (err) => {
      setActionError(
        err instanceof Error ? err.message : "Failed to approve client"
      );
    },
  });

  const busy =
    createOrgMutation.isPending ||
    setActiveMutation.isPending ||
    approveMutation.isPending;

  const handleCreateOrg = () => {
    setActionError(null);
    setActionOk(null);
    if (!(newOrgName.trim() && newOrgSlug)) {
      setActionError("Organization name is required.");
      return;
    }
    createOrgMutation.mutate({ name: newOrgName.trim(), slug: newOrgSlug });
  };

  const handleSetActive = (organizationId: string) => {
    setActionError(null);
    setActionOk(null);
    setActiveMutation.mutate(organizationId);
  };

  const handleApproveUnowned = (clientId: string) => {
    setActionError(null);
    setActionOk(null);
    approveMutation.mutate(clientId);
  };

  if (sessionPending) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Loading…
      </div>
    );
  }

  const orgs = orgsQuery.data ?? [];
  const ownedClients = ownedQuery.data ?? [];
  const unownedClients = unownedQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        description="Manage OAuth clients registered via Dynamic Client Registration. The user controls data access at consent time — organization assignment is for operational management."
        title="Applications"
      />

      {actionError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {actionOk ? (
        <Alert>
          <AlertDescription>{actionOk}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Organization Context</CardTitle>
          <CardDescription>
            OAuth clients are assigned to an organization for management. Set an
            active organization to view and manage clients.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgsQuery.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {orgsQuery.error instanceof Error
                  ? orgsQuery.error.message
                  : "Failed to list organizations"}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <div className="text-muted-foreground">Active organization</div>
              <div className="font-mono text-xs">{activeOrgId ?? "none"}</div>
            </div>
            <Button
              disabled={orgsQuery.isLoading || busy}
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["organizations"] });
              }}
              variant="outline"
            >
              {orgsQuery.isFetching ? <Spinner /> : "Refresh"}
            </Button>
          </div>

          {orgs.length > 0 ? (
            <div className="space-y-2">
              <Label>Switch active organization</Label>
              <div className="flex flex-wrap gap-2">
                {orgs.map((org) => (
                  <Button
                    disabled={busy || org.id === activeOrgId}
                    key={org.id}
                    onClick={() => handleSetActive(org.id)}
                    size="sm"
                    variant={org.id === activeOrgId ? "default" : "outline"}
                  >
                    {org.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                No organizations found for your account. Create one to continue.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">New organization name</Label>
              <Input
                id="org-name"
                onChange={(e) => setNewOrgName(e.target.value)}
                placeholder="My Organization"
                value={newOrgName}
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input readOnly value={newOrgSlug || " "} />
            </div>
          </div>

          <Button
            disabled={createOrgMutation.isPending || busy}
            onClick={handleCreateOrg}
          >
            {createOrgMutation.isPending ? <Spinner /> : "Create organization"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Applications</CardTitle>
          <CardDescription>
            OAuth clients assigned to the active organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OwnedClientsContent
            activeOrgId={activeOrgId}
            clients={ownedClients}
            loading={ownedQuery.isLoading}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Registrations</CardTitle>
          <CardDescription>
            Clients registered via Dynamic Client Registration that haven't been
            assigned to an organization yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unownedQuery.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {unownedQuery.error instanceof Error
                  ? unownedQuery.error.message
                  : "Failed to fetch clients"}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-muted-foreground text-sm">
              {unownedQuery.isLoading
                ? "Loading…"
                : `${unownedClients.length} client(s)`}
            </div>
            <Button
              disabled={!activeOrgId || unownedQuery.isLoading || busy}
              onClick={() => {
                queryClient.invalidateQueries({
                  queryKey: ["rp-admin", "clients", "unowned"],
                });
              }}
              variant="outline"
            >
              {unownedQuery.isFetching ? <Spinner /> : "Refresh"}
            </Button>
          </div>

          {unownedClients.length === 0 ? (
            <Alert>
              <AlertDescription>No pending registrations.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {unownedClients.map((c) => (
                <ClientCard
                  action={
                    <Button
                      disabled={!activeOrgId || busy}
                      onClick={() => handleApproveUnowned(c.clientId)}
                      size="sm"
                    >
                      {approveMutation.isPending ? (
                        <Spinner />
                      ) : (
                        "Assign to organization"
                      )}
                    </Button>
                  }
                  clientId={c.clientId}
                  key={c.clientId}
                  name={c.name}
                  redirectUris={c.redirectUris}
                  scopes={c.scopes}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
