import { FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ExchangeHeaderProps {
  activeSection: "portfolio" | "markets" | "trade";
  isAuthenticated: boolean;
  isConnectReady: boolean;
  isVerified: boolean;
  onConnect: () => void;
  onSectionChange: (section: "portfolio" | "markets" | "trade") => void;
  onSignOut: () => void;
}

export function ExchangeHeader({
  activeSection,
  isConnectReady,
  onSectionChange,
  isAuthenticated,
  isVerified,
  onConnect,
  onSignOut,
}: ExchangeHeaderProps) {
  const tabs = isAuthenticated
    ? (["portfolio", "markets", "trade"] as const)
    : (["markets"] as const);

  return (
    <header className="sticky top-0 z-50 border-border border-b bg-card/50 backdrop-blur-md">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded bg-primary text-primary-foreground shadow-[0_0_10px_rgba(var(--primary),0.5)]">
              <HugeiconsIcon icon={FlashIcon} size={20} />
            </div>
            <span className="font-bold font-mono text-xl uppercase tracking-tighter">
              Nova<span className="text-primary">X</span>
            </span>
          </div>

          <nav className="flex rounded-md border border-border/50 bg-secondary/50 p-1">
            {tabs.map((section) => (
              <button
                className={`rounded px-4 py-1.5 font-bold text-xs uppercase tracking-wider transition-all ${
                  activeSection === section
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
                key={section}
                onClick={() => onSectionChange(section)}
                type="button"
              >
                {section}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 rounded border border-border/30 bg-secondary/30 px-2 py-1 text-[10px] md:flex">
            <span className="flex size-2 animate-pulse rounded-full bg-success" />
            <span className="font-mono text-success">SYSTEM OPERATIONAL</span>
          </div>

          {isVerified && (
            <Badge
              className="border-success/50 bg-success/10 font-mono text-success"
              variant="outline"
            >
              Lv.2 VERIFIED
            </Badge>
          )}

          <div className="flex items-center gap-2 border-border/50 border-l pl-4">
            {isAuthenticated ? (
              <Button
                className="font-mono text-muted-foreground text-xs hover:bg-destructive/10 hover:text-destructive"
                onClick={onSignOut}
                size="sm"
                variant="ghost"
              >
                DISCONNECT
              </Button>
            ) : (
              <Button
                className="font-bold font-mono text-xs uppercase tracking-wider"
                disabled={!isConnectReady}
                onClick={onConnect}
                size="sm"
              >
                Connect with Zentity
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
