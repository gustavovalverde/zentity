"use client";

import {
  Check,
  Edit2,
  KeyRound,
  Loader2,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import {
  checkPrfSupport,
  createCredentialWithPrf,
  evaluatePrf,
  extractCredentialRegistrationData,
} from "@/lib/crypto/webauthn-prf";
import { trpc } from "@/lib/trpc/client";
import { base64UrlToBytes } from "@/lib/utils/base64url";

interface PasskeyCredential {
  id: string;
  credentialId: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean | null;
  createdAt: string;
  lastUsedAt: string | null;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  Uint8Array.from(bytes).buffer;

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return "Never";
  }
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DeviceIcon({ deviceType }: { deviceType: string | null }) {
  if (deviceType === "platform") {
    return <Monitor className="h-4 w-4" />;
  }
  return <Smartphone className="h-4 w-4" />;
}

export function PasskeyManagementSection() {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadPasskeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const credentials = await trpc.passkeyAuth.listCredentials.query();
      setPasskeys(credentials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load passkeys");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load passkeys on mount
  useEffect(() => {
    loadPasskeys().catch(() => {
      // Error is already handled in loadPasskeys via setError
    });
    checkPrfSupport()
      .then((result) => setPrfSupported(result.supported))
      .catch(() => {
        // PRF is optional; absence handled gracefully
      });
  }, [loadPasskeys]);

  const handleAddPasskey = async () => {
    if (!prfSupported) {
      toast.error("Your device doesn't support the required passkey features.");
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      // Get registration options
      const options = await trpc.passkeyAuth.getAddCredentialOptions.query();
      const prfSalt = generatePrfSalt();

      // Build WebAuthn options
      const webAuthnOptions: PublicKeyCredentialCreationOptions = {
        rp: {
          id: options.rp.id,
          name: options.rp.name,
        },
        user: {
          id: Uint8Array.from(new TextEncoder().encode(options.user.id)),
          name: options.user.email,
          displayName: options.user.name,
        },
        challenge: Uint8Array.from(base64UrlToBytes(options.challenge)),
        pubKeyCredParams: [
          { type: "public-key" as const, alg: -8 },
          { type: "public-key" as const, alg: -7 },
          { type: "public-key" as const, alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required" as const,
          userVerification: "required" as const,
        },
        timeout: 60_000,
        attestation: "none" as const,
        excludeCredentials: options.excludeCredentials?.map((cred) => ({
          type: "public-key" as const,
          id: toArrayBuffer(base64UrlToBytes(cred.id)),
          transports: cred.transports as AuthenticatorTransport[],
        })),
        extensions: {
          prf: {
            eval: {
              first: toArrayBuffer(prfSalt),
            },
          },
        },
      };

      // Create passkey
      const {
        credential,
        credentialId,
        prfOutput: initialPrfOutput,
      } = await createCredentialWithPrf(webAuthnOptions);

      // Evaluate PRF if not available during creation
      let prfOutput = initialPrfOutput;
      if (!prfOutput) {
        const { prfOutputs } = await evaluatePrf({
          credentialIdToSalt: { [credentialId]: prfSalt },
        });
        prfOutput =
          prfOutputs.get(credentialId) ??
          prfOutputs.values().next().value ??
          null;
      }
      if (!prfOutput) {
        throw new Error(
          "This passkey did not return PRF output. Please try a different authenticator."
        );
      }

      // Extract credential data
      const credentialData = extractCredentialRegistrationData(credential);

      // Register with server
      await trpc.passkeyAuth.addCredential.mutate({
        challengeId: options.challengeId,
        credential: {
          credentialId: credentialData.credentialId,
          publicKey: credentialData.publicKey,
          counter: credentialData.counter,
          deviceType: credentialData.deviceType,
          backedUp: credentialData.backedUp,
          transports: credentialData.transports,
          name: `Passkey ${passkeys.length + 1}`,
        },
      });

      toast.success("Passkey added successfully!");
      await loadPasskeys();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to add passkey. Please try again.";

      if (
        message.includes("NotAllowedError") ||
        message.includes("cancelled")
      ) {
        setIsAdding(false);
        return; // User cancelled
      }

      setError(message);
      toast.error("Failed to add passkey", { description: message });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeletePasskey = async (credentialId: string) => {
    setIsDeleting(true);

    try {
      await trpc.passkeyAuth.removeCredential.mutate({ credentialId });
      toast.success("Passkey removed successfully");
      await loadPasskeys();
    } catch (err) {
      toast.error("Failed to remove passkey", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleStartEdit = (passkey: PasskeyCredential) => {
    setEditingId(passkey.credentialId);
    setEditName(passkey.name || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleSaveEdit = async () => {
    if (!(editingId && editName.trim())) {
      return;
    }

    setIsSaving(true);

    try {
      await trpc.passkeyAuth.renameCredential.mutate({
        credentialId: editingId,
        name: editName.trim(),
      });
      toast.success("Passkey renamed successfully");
      await loadPasskeys();
    } catch (err) {
      toast.error("Failed to rename passkey", {
        description: err instanceof Error ? err.message : "Please try again",
      });
    } finally {
      setIsSaving(false);
      setEditingId(null);
      setEditName("");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Passkeys
        </CardTitle>
        <CardDescription>
          Manage your passkeys for secure passwordless authentication
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {(() => {
          if (isLoading) {
            return (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            );
          }

          if (passkeys.length === 0) {
            return (
              <div className="py-6 text-center text-muted-foreground">
                <KeyRound className="mx-auto mb-3 h-12 w-12 opacity-50" />
                <p>No passkeys registered yet.</p>
                <p className="mt-1 text-sm">
                  Add a passkey for secure, passwordless sign-in.
                </p>
              </div>
            );
          }

          return (
            <div className="space-y-3">
              {passkeys.map((passkey) => (
                <div
                  className="flex items-center justify-between rounded-lg border bg-card p-3"
                  key={passkey.id}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <DeviceIcon deviceType={passkey.deviceType} />
                    </div>
                    <div className="space-y-1">
                      {editingId === passkey.credentialId ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            className="h-7 w-40"
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleSaveEdit().catch(() => {
                                  // Error feedback provided by handleSaveEdit() internally
                                });
                              }
                              if (e.key === "Escape") {
                                handleCancelEdit();
                              }
                            }}
                            value={editName}
                          />
                          <Button
                            disabled={isSaving || !editName.trim()}
                            onClick={handleSaveEdit}
                            size="sm"
                            variant="ghost"
                          >
                            {isSaving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            disabled={isSaving}
                            onClick={handleCancelEdit}
                            size="sm"
                            variant="ghost"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {passkey.name || "Unnamed Passkey"}
                          </p>
                          <Button
                            className="h-6 w-6 p-0"
                            onClick={() => handleStartEdit(passkey)}
                            size="sm"
                            variant="ghost"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <span>Added {formatDate(passkey.createdAt)}</span>
                        {passkey.lastUsedAt ? (
                          <>
                            <span>·</span>
                            <span>
                              Last used {formatDate(passkey.lastUsedAt)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {passkey.backedUp ? (
                      <Badge className="text-xs" variant="secondary">
                        Synced
                      </Badge>
                    ) : null}
                    <Button
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={passkeys.length <= 1}
                      onClick={() => setDeleteConfirm(passkey.credentialId)}
                      size="sm"
                      title={
                        passkeys.length <= 1
                          ? "Cannot remove your only passkey"
                          : "Remove passkey"
                      }
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Add passkey button */}
        <Button
          className="w-full"
          disabled={isAdding || prfSupported === false}
          onClick={handleAddPasskey}
          variant="outline"
        >
          {isAdding ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating passkey...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add Passkey
            </>
          )}
        </Button>

        {prfSupported === false && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription className="ml-2 text-xs">
              Your device doesn't support the required passkey features (PRF
              extension).
            </AlertDescription>
          </Alert>
        )}

        {/* Delete confirmation dialog */}
        <AlertDialog
          onOpenChange={(open: boolean) => !open && setDeleteConfirm(null)}
          open={deleteConfirm !== null}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Passkey?</AlertDialogTitle>
              <AlertDialogDescription>
                This passkey will be removed from your account. You'll need to
                use another passkey or recovery method to sign in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting}
                onClick={() =>
                  deleteConfirm && handleDeletePasskey(deleteConfirm)
                }
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Remove Passkey"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
