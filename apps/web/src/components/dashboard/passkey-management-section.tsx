"use client";

import {
  Check,
  Edit2,
  KeyRound,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useOptimistic, useState } from "react";
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  deletePasskey,
  listUserPasskeys,
  registerPasskeyWithPrf,
  renamePasskey,
  signInWithPasskey,
} from "@/lib/auth/passkey";
import { FHE_SECRET_TYPE } from "@/lib/crypto/fhe-key-store";
import { generatePrfSalt } from "@/lib/crypto/key-derivation";
import { PROFILE_SECRET_TYPE } from "@/lib/crypto/profile-secret";
import { addWrapperForSecretType } from "@/lib/crypto/secret-vault";
import { checkPrfSupport } from "@/lib/crypto/webauthn-prf";

interface PasskeyCredential {
  id: string;
  credentialID: string;
  name?: string | null;
  deviceType?: string | null;
  backedUp?: boolean;
  createdAt?: string | Date | null;
}

function formatDate(dateValue: string | Date | null | undefined): string {
  if (!dateValue) {
    return "Never";
  }
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function DeviceIcon({ deviceType }: Readonly<{ deviceType?: string | null }>) {
  if (deviceType === "platform" || deviceType === "singleDevice") {
    return <Monitor className="h-4 w-4" />;
  }
  return <Smartphone className="h-4 w-4" />;
}

type OptimisticAction =
  | { type: "delete"; id: string }
  | { type: "rename"; id: string; name: string };

// Grouped editing state to reduce cognitive load
interface EditState {
  id: string | null;
  name: string;
}

const INITIAL_EDIT_STATE: EditState = { id: null, name: "" };

export function PasskeyManagementSection() {
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>(INITIAL_EDIT_STATE);

  // Optimistic state for instant feedback on delete and rename
  const [optimisticPasskeys, applyOptimistic] = useOptimistic(
    passkeys,
    (currentPasskeys, action: OptimisticAction) => {
      if (action.type === "delete") {
        return currentPasskeys.filter((p) => p.id !== action.id);
      }
      // Rename
      return currentPasskeys.map((p) =>
        p.id === action.id ? { ...p, name: action.name } : p
      );
    }
  );

  const loadPasskeys = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listUserPasskeys();
      if (result.error || !result.data) {
        throw new Error(result.error?.message || "Failed to load passkeys");
      }
      setPasskeys(result.data);
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
      // Step-up authentication: verify user identity with existing passkey
      // before allowing new passkey registration. This prevents session hijacking
      // attacks where an attacker with a stale session could add their own passkey.
      const stepUp = await signInWithPasskey();
      if (!stepUp.ok) {
        throw new Error(
          stepUp.message || "Please verify your identity to add a new passkey."
        );
      }

      const prfSalt = generatePrfSalt();
      const registration = await registerPasskeyWithPrf({
        name: `Passkey ${optimisticPasskeys.length + 1}`,
        prfSalt,
      });

      if (!registration.ok) {
        throw new Error(registration.message);
      }

      const { credentialId, prfOutput } = registration;

      await addWrapperForSecretType({
        secretType: FHE_SECRET_TYPE,
        newCredentialId: credentialId,
        newPrfOutput: prfOutput,
        newPrfSalt: prfSalt,
      });

      await addWrapperForSecretType({
        secretType: PROFILE_SECRET_TYPE,
        newCredentialId: credentialId,
        newPrfOutput: prfOutput,
        newPrfSalt: prfSalt,
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

  const handleDeletePasskey = async (id: string) => {
    // Close dialog immediately for instant feedback
    setDeleteConfirm(null);

    // Apply optimistic update - item disappears instantly
    applyOptimistic({ type: "delete", id });

    try {
      const result = await deletePasskey(id);
      if (result.error) {
        throw new Error(result.error.message || "Failed to remove passkey");
      }
      toast.success("Passkey removed successfully");
      await loadPasskeys();
    } catch (err) {
      // On error, loadPasskeys will restore the item
      toast.error("Failed to remove passkey", {
        description: err instanceof Error ? err.message : "Please try again",
      });
      await loadPasskeys();
    }
  };

  const handleStartEdit = useCallback((passkey: PasskeyCredential) => {
    setEditState({ id: passkey.id, name: passkey.name || "" });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditState(INITIAL_EDIT_STATE);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    const { id: passkeyId, name } = editState;
    const newName = name.trim();

    if (!(passkeyId && newName)) {
      return;
    }

    // Close edit mode immediately for instant feedback
    setEditState(INITIAL_EDIT_STATE);

    // Apply optimistic update - name changes instantly
    applyOptimistic({ type: "rename", id: passkeyId, name: newName });

    try {
      const result = await renamePasskey(passkeyId, newName);
      if (result.error) {
        throw new Error(result.error.message || "Failed to rename passkey");
      }
      toast.success("Passkey renamed successfully");
      await loadPasskeys();
    } catch (err) {
      // On error, loadPasskeys will restore the original name
      toast.error("Failed to rename passkey", {
        description: err instanceof Error ? err.message : "Please try again",
      });
      await loadPasskeys();
    }
  }, [editState, applyOptimistic, loadPasskeys]);

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

          if (optimisticPasskeys.length === 0) {
            return (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <KeyRound />
                  </EmptyMedia>
                  <EmptyTitle>No Passkeys Registered</EmptyTitle>
                  <EmptyDescription>
                    Add a passkey for secure, passwordless sign-in.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            );
          }

          return (
            <ItemGroup>
              {optimisticPasskeys.map((passkey) => (
                <Item key={passkey.id} size="sm" variant="outline">
                  <ItemMedia variant="icon">
                    <DeviceIcon deviceType={passkey.deviceType} />
                  </ItemMedia>
                  <ItemContent>
                    {editState.id === passkey.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label="Passkey name"
                          autoFocus
                          className="h-7 w-40"
                          name="passkeyName"
                          onChange={(e) =>
                            setEditState((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
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
                          value={editState.name}
                        />
                        <Button
                          aria-label="Save passkey name"
                          disabled={!editState.name.trim()}
                          onClick={handleSaveEdit}
                          size="sm"
                          variant="ghost"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          aria-label="Cancel editing passkey name"
                          onClick={handleCancelEdit}
                          size="sm"
                          variant="ghost"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <ItemTitle className="flex items-center gap-2">
                        {passkey.name || "Unnamed Passkey"}
                        <Button
                          aria-label="Edit passkey name"
                          className="h-6 w-6 p-0"
                          onClick={() => handleStartEdit(passkey)}
                          size="sm"
                          variant="ghost"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                      </ItemTitle>
                    )}
                    <p className="text-muted-foreground text-xs">
                      Added {formatDate(passkey.createdAt)}
                    </p>
                  </ItemContent>
                  <ItemActions>
                    {passkey.backedUp ? (
                      <Badge className="text-xs" variant="secondary">
                        Synced
                      </Badge>
                    ) : null}
                    <Button
                      aria-label={
                        optimisticPasskeys.length <= 1
                          ? "Cannot remove your only passkey"
                          : "Remove passkey"
                      }
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={optimisticPasskeys.length <= 1}
                      onClick={() => setDeleteConfirm(passkey.id)}
                      size="sm"
                      title={
                        optimisticPasskeys.length <= 1
                          ? "Cannot remove your only passkey"
                          : "Remove passkey"
                      }
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
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
            <Spinner aria-hidden="true" className="mr-2" size="sm" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Add Passkey
        </Button>

        {prfSupported === false && (
          <Alert>
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription className="ml-2 text-xs">
              Your device doesn't support the required passkey security
              features.
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
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() =>
                  deleteConfirm && handleDeletePasskey(deleteConfirm)
                }
              >
                Remove Passkey
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
