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
import { base64UrlToBytes } from "@/lib/utils";

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
  if (!dateString) return "Never";
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
    loadPasskeys();
    void checkPrfSupport().then((result) => setPrfSupported(result.supported));
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
          "This passkey did not return PRF output. Please try a different authenticator.",
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
    if (!editingId || !editName.trim()) return;

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
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : passkeys.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <KeyRound className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No passkeys registered yet.</p>
            <p className="text-sm mt-1">
              Add a passkey for secure, passwordless sign-in.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {passkeys.map((passkey) => (
              <div
                key={passkey.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <DeviceIcon deviceType={passkey.deviceType} />
                  </div>
                  <div className="space-y-1">
                    {editingId === passkey.credentialId ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 w-40"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveEdit();
                            if (e.key === "Escape") handleCancelEdit();
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleSaveEdit}
                          disabled={isSaving || !editName.trim()}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                          disabled={isSaving}
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
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => handleStartEdit(passkey)}
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Added {formatDate(passkey.createdAt)}</span>
                      {passkey.lastUsedAt && (
                        <>
                          <span>·</span>
                          <span>
                            Last used {formatDate(passkey.lastUsedAt)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {passkey.backedUp && (
                    <Badge variant="secondary" className="text-xs">
                      Synced
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteConfirm(passkey.credentialId)}
                    disabled={passkeys.length <= 1}
                    title={
                      passkeys.length <= 1
                        ? "Cannot remove your only passkey"
                        : "Remove passkey"
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add passkey button */}
        <Button
          className="w-full"
          variant="outline"
          onClick={handleAddPasskey}
          disabled={isAdding || prfSupported === false}
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
          open={deleteConfirm !== null}
          onOpenChange={(open: boolean) => !open && setDeleteConfirm(null)}
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
                onClick={() =>
                  deleteConfirm && handleDeletePasskey(deleteConfirm)
                }
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
