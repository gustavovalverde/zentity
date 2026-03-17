import { ArrowLeft01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface VeriPassHeaderProps {
  hasCredential: boolean;
  onSignOut: () => void;
  userEmail?: string | undefined;
}

export function VeriPassHeader({
  hasCredential,
  userEmail,
  onSignOut,
}: VeriPassHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Link
            className="text-muted-foreground transition-colors hover:text-foreground"
            href="/"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={18} />
          </Link>
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              className="text-primary"
              icon={Wallet01Icon}
              size={22}
            />
            <span className="font-bold text-lg tracking-tight">VeriPass</span>
          </div>
          {hasCredential && (
            <Badge
              className="bg-success/15 text-success text-xs"
              variant="secondary"
            >
              1 Credential
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          {userEmail && (
            <span className="hidden text-muted-foreground text-sm sm:block">
              {userEmail}
            </span>
          )}
          <Button onClick={onSignOut} size="sm" variant="ghost">
            Sign Out
          </Button>
        </div>
      </div>
    </header>
  );
}
