"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  name: string | null;
  scopes: unknown;
  redirectUris: unknown;
  disabled: boolean;
  createdAt: number;
}

interface UnownedClient {
  clientId: string;
  name: string | null;
  redirectUris: unknown;
  scopes: unknown;
  createdAt: number;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

async function jsonOrNull<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
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
          No clients assigned to this organization yet. Clients register via DCR
          and appear in &ldquo;Pending Registrations&rdquo; below.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {clients.map((c) => (
        <div
          className="flex flex-col gap-2 rounded-md border p-3"
          key={c.clientId}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">{c.name || "Unnamed client"}</div>
              <div className="font-mono text-muted-foreground text-xs">
                {c.clientId}
              </div>
            </div>
            {c.disabled && (
              <span className="rounded bg-destructive/10 px-2 py-0.5 font-medium text-destructive text-xs">
                Disabled
              </span>
            )}
          </div>
          <div className="text-muted-foreground text-xs">
            Scopes:{" "}
            <span className="font-mono">
              {Array.isArray(c.scopes)
                ? c.scopes.join(", ")
                : JSON.stringify(c.scopes)}
            </span>
          </div>
          <div className="text-muted-foreground text-xs">
            Redirect URIs:{" "}
            <span className="font-mono">
              {Array.isArray(c.redirectUris)
                ? c.redirectUris.join(", ")
                : JSON.stringify(c.redirectUris)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ApplicationsPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const activeOrgId = session?.session?.activeOrganizationId ?? null;

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState("");
  const newOrgSlug = useMemo(() => slugify(newOrgName) || "", [newOrgName]);
  const [creatingOrg, setCreatingOrg] = useState(false);

  const [ownedClients, setOwnedClients] = useState<OwnedClient[]>([]);
  const [ownedLoading, setOwnedLoading] = useState(false);

  const [unownedClients, setUnownedClients] = useState<UnownedClient[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshOrganizations = useCallback(async (): Promise<void> => {
    setOrgError(null);
    setOrgsLoading(true);
    try {
      const result = await authClient.organization.list();
      if (result.error) {
        throw new Error(result.error.message || "Failed to list organizations");
      }
      setOrgs((result.data ?? []) as Org[]);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to list orgs");
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  const refreshOwnedClients = useCallback(async (): Promise<void> => {
    setOwnedLoading(true);
    try {
      const response = await fetch("/api/rp-admin/clients/owned");
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { clients: OwnedClient[] };
      setOwnedClients(body.clients ?? []);
    } catch {
      // Non-critical — silently fail
    } finally {
      setOwnedLoading(false);
    }
  }, []);

  const refreshUnownedClients = useCallback(async (): Promise<void> => {
    setClientsError(null);
    setClientsLoading(true);
    try {
      const response = await fetch("/api/rp-admin/clients/unowned");
      if (!response.ok) {
        const body = await jsonOrNull<{ error?: string }>(response);
        throw new Error(body?.error || "Failed to fetch clients");
      }
      const body = (await response.json()) as { clients: UnownedClient[] };
      setUnownedClients(body.clients ?? []);
    } catch (err) {
      setClientsError(
        err instanceof Error ? err.message : "Failed to fetch clients"
      );
    } finally {
      setClientsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionPending && session) {
      refreshOrganizations().catch(() => undefined);
    }
  }, [sessionPending, session, refreshOrganizations]);

  useEffect(() => {
    if (!sessionPending && session && activeOrgId) {
      refreshOwnedClients().catch(() => undefined);
      refreshUnownedClients().catch(() => undefined);
    }
  }, [
    sessionPending,
    session,
    activeOrgId,
    refreshOwnedClients,
    refreshUnownedClients,
  ]);

  const handleCreateOrg = async () => {
    setActionError(null);
    setActionOk(null);

    if (!(newOrgName.trim() && newOrgSlug)) {
      setActionError("Organization name is required.");
      return;
    }

    setCreatingOrg(true);
    try {
      const result = await authClient.organization.create({
        name: newOrgName.trim(),
        slug: newOrgSlug,
      });
      if (result.error) {
        throw new Error(
          result.error.message || "Failed to create organization"
        );
      }
      setNewOrgName("");
      setActionOk("Organization created.");
      await refreshOrganizations();
      globalThis.window.location.reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to create organization"
      );
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleSetActive = async (organizationId: string) => {
    setActionError(null);
    setActionOk(null);
    setBusy(true);
    try {
      const result = await authClient.organization.setActive({
        organizationId,
      });
      if (result.error) {
        throw new Error(result.error.message || "Failed to set active org");
      }
      setActionOk("Active organization updated.");
      globalThis.window.location.reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to set active org"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleApproveUnowned = async (clientId: string) => {
    setActionError(null);
    setActionOk(null);
    setBusy(true);
    try {
      const response = await fetch("/api/rp-admin/clients/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, force: false }),
      });
      if (!response.ok) {
        const body = await jsonOrNull<{ error?: string }>(response);
        throw new Error(body?.error || "Failed to approve client");
      }
      setActionOk("Client assigned to active organization.");
      await Promise.all([refreshOwnedClients(), refreshUnownedClients()]);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to approve client"
      );
    } finally {
      setBusy(false);
    }
  };

  if (sessionPending) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl">Applications</h1>
        <p className="text-muted-foreground text-sm">
          Manage OAuth clients registered via Dynamic Client Registration. The
          user controls data access at consent time — organization assignment is
          for operational management.
        </p>
      </div>

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
          {orgError ? (
            <Alert variant="destructive">
              <AlertDescription>{orgError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              <div className="text-muted-foreground">Active organization</div>
              <div className="font-mono text-xs">{activeOrgId ?? "none"}</div>
            </div>
            <Button
              disabled={orgsLoading || busy}
              onClick={() => {
                refreshOrganizations().catch(() => undefined);
              }}
              variant="outline"
            >
              {orgsLoading ? <Spinner /> : "Refresh"}
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
                    onClick={() => {
                      handleSetActive(org.id).catch(() => undefined);
                    }}
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
            disabled={creatingOrg || busy}
            onClick={() => {
              handleCreateOrg().catch(() => undefined);
            }}
          >
            {creatingOrg ? <Spinner /> : "Create organization"}
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
            loading={ownedLoading}
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
          {clientsError ? (
            <Alert variant="destructive">
              <AlertDescription>{clientsError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-sm">
              {clientsLoading
                ? "Loading…"
                : `${unownedClients.length} client(s)`}
            </div>
            <Button
              disabled={!activeOrgId || clientsLoading || busy}
              onClick={() => {
                refreshUnownedClients().catch(() => undefined);
              }}
              variant="outline"
            >
              {clientsLoading ? <Spinner /> : "Refresh"}
            </Button>
          </div>

          {unownedClients.length === 0 ? (
            <Alert>
              <AlertDescription>No pending registrations.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {unownedClients.map((c) => (
                <div
                  className="flex flex-col gap-2 rounded-md border p-3"
                  key={c.clientId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {c.name || "Unnamed client"}
                      </div>
                      <div className="font-mono text-muted-foreground text-xs">
                        {c.clientId}
                      </div>
                    </div>
                    <Button
                      disabled={!activeOrgId || busy}
                      onClick={() => {
                        handleApproveUnowned(c.clientId).catch(() => undefined);
                      }}
                      size="sm"
                    >
                      {busy ? <Spinner /> : "Assign to org"}
                    </Button>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Redirect URIs:{" "}
                    <span className="font-mono">
                      {Array.isArray(c.redirectUris)
                        ? c.redirectUris.join(", ")
                        : JSON.stringify(c.redirectUris)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
