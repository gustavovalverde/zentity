import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface WineHeaderProps {
  activeTab: "browse" | "cart";
  cartCount: number;
  isSignedIn: boolean;
  isVerified: boolean;
  onSignOut: () => void;
  onTabChange: (tab: "browse" | "cart") => void;
}

function WineIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.118 3.118 0 01-2.22.92H9.69a3.118 3.118 0 01-2.22-.92L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WineHeader({
  activeTab,
  onTabChange,
  cartCount,
  isVerified,
  isSignedIn,
  onSignOut,
}: WineHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-border/40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-12">
          <div className="group flex cursor-pointer items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2 transition-colors group-hover:bg-primary/20">
              <WineIcon className="size-6 text-primary" />
            </div>
            <span className="font-bold font-serif text-2xl text-foreground tracking-tight">
              Vino Delivery
            </span>
          </div>
          <nav className="hidden gap-2 md:flex">
            <button
              className={`rounded-full px-5 py-2 font-medium text-sm transition-all duration-300 ${
                activeTab === "browse"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => onTabChange("browse")}
              type="button"
            >
              Collection
            </button>
            <button
              className={`relative rounded-full px-5 py-2 font-medium text-sm transition-all duration-300 ${
                activeTab === "cart"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => onTabChange("cart")}
              type="button"
            >
              Your Cellar
              {cartCount > 0 && (
                <span className="zoom-in absolute -top-1 -right-1 flex size-5 animate-in items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground text-xs">
                  {cartCount}
                </span>
              )}
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {isVerified && (
            <Badge
              className="border-success/30 bg-success/5 px-3 py-1 font-sans text-success tracking-wide"
              variant="outline"
            >
              Verified 21+
            </Badge>
          )}
          {isSignedIn && (
            <Button
              className="font-sans text-muted-foreground hover:text-foreground"
              onClick={onSignOut}
              size="sm"
              variant="ghost"
            >
              Sign Out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
