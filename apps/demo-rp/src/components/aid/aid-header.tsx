import { Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

interface AidHeaderProps {
  isVerified?: boolean;
  onSignOut: () => void;
  userEmail?: string | null;
}

export function AidHeader({
  userEmail,
  isVerified,
  onSignOut,
}: AidHeaderProps) {
  return (
    <header className="relative z-10 border-b bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <HugeiconsIcon icon={Globe02Icon} size={24} />
          </div>
          <div>
            <span className="block font-bold text-foreground text-lg leading-none tracking-tight">
              Relief Global
            </span>
            <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              Humanitarian Aid
            </span>
          </div>
        </div>

        {userEmail && (
          <div className="flex items-center gap-4">
            <div className="hidden text-right md:block">
              <div className="font-medium text-sm">{userEmail}</div>
              <div className="flex items-center justify-end gap-1 font-bold text-[10px] text-success uppercase tracking-wider">
                {isVerified && (
                  <span className="size-1.5 animate-pulse rounded-full bg-success" />
                )}
                {isVerified ? "Verified Beneficiary" : "Unverified"}
              </div>
            </div>
            <button
              className="font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
              onClick={onSignOut}
              type="button"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
