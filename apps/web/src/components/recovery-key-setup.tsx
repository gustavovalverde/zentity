"use client";

import { Copy, Download } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { asyncHandler } from "@/lib/async-handler";
import { generateRecoveryKey } from "@/lib/privacy/credentials/recovery-key";
import { addVaultCredential, type VaultKey } from "@/lib/privacy/secrets/vault";

function recoveryKeyText(words: string[]): string {
  const numbered = words.map((word, index) => `${index + 1}. ${word}`);
  return [
    "Zentity recovery key",
    "",
    ...numbered,
    "",
    "Use these 24 words to open your encrypted data if you lose your passkeys, password, or wallet.",
    "Keep them private. Zentity can't show them again or recover them for you.",
    "",
  ].join("\n");
}

/**
 * Generates a recovery key in the browser, shows it once, and wraps the
 * vault key for it after the user confirms they saved it.
 */
export function RecoveryKeySetup({
  vaultKey,
  replacing = false,
  onCancel,
  onSaved,
}: Readonly<{
  vaultKey: VaultKey;
  replacing?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}>) {
  const [recoveryKey] = useState(() => {
    const generated = generateRecoveryKey();
    return {
      ...generated,
      numbered: generated.words.map((word, index) => ({
        position: index + 1,
        word,
      })),
    };
  });
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey.words.join(" "));
      toast.success("Recovery key copied");
    } catch {
      toast.error("Couldn't copy. Select the words and copy them instead.");
    }
  };

  const download = () => {
    const blob = new Blob([recoveryKeyText(recoveryKey.words)], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zentity-recovery-key.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await addVaultCredential(vaultKey, {
        type: "recovery_key",
        recoveryKey: recoveryKey.key,
      });
      recoveryKey.key.fill(0);
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save your recovery key."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Write these 24 words down or store them in a password manager. With them
        you can open your encryption keys and verified profile if you lose your
        other sign-in methods. Zentity never sees them and can't show them
        again.
        {replacing ? " Your previous recovery key will stop working." : ""}
      </p>

      <ol
        aria-label="Recovery key"
        className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-4 font-mono text-sm sm:grid-cols-3"
        data-testid="recovery-key-words"
      >
        {recoveryKey.numbered.map(({ position, word }) => (
          <li className="flex gap-2" key={position}>
            <span className="w-6 text-right text-muted-foreground">
              {position}.
            </span>
            <span>{word}</span>
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <Button
          onClick={asyncHandler(copy)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Copy />
          Copy
        </Button>
        <Button onClick={download} size="sm" type="button" variant="outline">
          <Download />
          Download
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-start gap-2">
        <Checkbox
          checked={confirmed}
          id={confirmId}
          onCheckedChange={(checked) => setConfirmed(checked === true)}
        />
        <Label className="font-normal leading-snug" htmlFor={confirmId}>
          I saved my recovery key somewhere safe
        </Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          disabled={saving}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          disabled={!confirmed || saving}
          onClick={asyncHandler(save)}
          type="button"
        >
          {saving ? <Spinner aria-hidden="true" size="sm" /> : null}
          Save recovery key
        </Button>
      </div>
    </div>
  );
}
