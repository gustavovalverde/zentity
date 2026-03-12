"use client";

import { useCallback, useState } from "react";
import { AssuranceBadges } from "@/components/shared/assurance-badges";
import { WineAgeGate } from "@/components/wine/wine-age-gate";
import { type CartItem, WineCart } from "@/components/wine/wine-cart";
import { WineHeader } from "@/components/wine/wine-header";
import { WineOrderConfirmation } from "@/components/wine/wine-order-confirmation";
import { WineProductGrid } from "@/components/wine/wine-product-grid";
import type { Wine } from "@/data/wine";
import { useOAuthFlow } from "@/hooks/use-oauth-flow";
import { getScenario } from "@/lib/scenarios";

const scenario = getScenario("wine");

export default function WinePage() {
  const {
    isPending,
    isAuthenticated,
    claims,
    isSteppedUp,
    handleSignIn,
    handleStepUp,
    handleSignOut,
  } = useOAuthFlow(scenario);

  const [activeTab, setActiveTab] = useState<"browse" | "cart">("browse");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderedItems, setOrderedItems] = useState<CartItem[]>([]);
  const [orderId, setOrderId] = useState("");

  const addToCart = useCallback((wine: Wine) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.wine.id === wine.id);
      if (existing) {
        return prev.map((item) =>
          item.wine.id === wine.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { wine, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((wineId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.wine.id !== wineId));
    } else {
      setCart((prev) =>
        prev.map((item) =>
          item.wine.id === wineId ? { ...item, quantity } : item
        )
      );
    }
  }, []);

  const removeFromCart = useCallback((wineId: string) => {
    setCart((prev) => prev.filter((item) => item.wine.id !== wineId));
  }, []);

  const handlePlaceOrder = useCallback(() => {
    setOrderedItems([...cart]);
    setOrderId(`VD-${Date.now().toString(36).toUpperCase()}`);
    setOrderPlaced(true);
    setCart([]);
  }, [cart]);

  const handleContinueShopping = useCallback(() => {
    setOrderPlaced(false);
    setOrderedItems([]);
    setActiveTab("browse");
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        data-theme="wine"
      >
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <WineAgeGate
        dcrConfig={scenario.dcr}
        onVerify={handleSignIn}
        providerId={scenario.id}
      />
    );
  }

  if (orderPlaced) {
    return (
      <div
        className="min-h-screen bg-background font-serif selection:bg-primary/20"
        data-theme="wine"
      >
        <WineHeader
          activeTab="cart"
          cartCount={0}
          isSignedIn={isAuthenticated}
          isVerified={isAuthenticated}
          onSignOut={handleSignOut}
          onTabChange={setActiveTab}
        />
        <main className="mx-auto max-w-7xl px-6 py-12">
          <WineOrderConfirmation
            claims={claims}
            items={orderedItems}
            onContinueShopping={handleContinueShopping}
            orderId={orderId}
          />
        </main>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background font-serif selection:bg-primary/20"
      data-theme="wine"
    >
      <WineHeader
        activeTab={activeTab}
        cartCount={cartCount}
        isSignedIn={isAuthenticated}
        isVerified={isAuthenticated}
        onSignOut={handleSignOut}
        onTabChange={setActiveTab}
      />

      <main className="mx-auto max-w-7xl px-6 py-12">
        <AssuranceBadges claims={claims} />
        {activeTab === "browse" ? (
          <div className="fade-in animate-in space-y-16 duration-700">
            <div className="space-y-6 border-border/40 border-b py-12 text-center">
              <span className="font-bold text-primary text-xs uppercase tracking-[0.2em]">
                Est. 1928
              </span>
              <h2 className="font-medium font-serif text-5xl text-foreground tracking-tight md:text-6xl">
                Fine Wines <i className="font-serif text-primary italic">&</i>{" "}
                Spirits
              </h2>
              <p className="mx-auto max-w-xl font-sans text-lg text-muted-foreground leading-relaxed">
                Curated selection derived from the world's most exclusive
                vineyards. Sourced responsibly, delivered directly to your
                cellar.
              </p>
            </div>

            <div>
              <div className="mb-8 flex items-center justify-between">
                <h3 className="font-medium text-xl tracking-wide">
                  Latest Collection
                </h3>
                <button
                  className="font-sans text-sm underline decoration-1 decoration-primary/50 underline-offset-4 transition-all hover:decoration-primary"
                  type="button"
                >
                  View All Regions
                </button>
              </div>
              <WineProductGrid onAddToCart={addToCart} />
            </div>
          </div>
        ) : (
          <div className="fade-in slide-in-from-right-8 mx-auto max-w-3xl animate-in duration-500">
            <h2 className="mb-8 border-b pb-4 font-serif text-3xl">
              Your Selection
            </h2>
            <WineCart
              claims={claims}
              isSteppedUp={isSteppedUp}
              items={cart}
              onPlaceOrder={handlePlaceOrder}
              onRemove={removeFromCart}
              onStepUp={handleStepUp}
              onUpdateQuantity={updateQuantity}
            />
          </div>
        )}
      </main>

      <footer className="mt-12 border-t bg-card py-12">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 text-center md:grid-cols-3 md:text-left">
          <div>
            <h4 className="mb-4 font-medium font-serif text-lg">
              Vino Delivery
            </h4>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Dedicated to sourcing the finest wines <br />
              from reputable growers worldwide.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="mb-4 font-medium font-serif text-lg">Contact</h4>
            <p className="text-muted-foreground text-sm">
              concierge@vinodelivery.com
            </p>
            <p className="text-muted-foreground text-sm">+1 (555) 012-3456</p>
          </div>
          <div className="flex flex-col items-center justify-center md:items-end">
            <span className="mb-2 text-muted-foreground text-xs uppercase tracking-wider">
              Verified Merchant
            </span>
            <div className="flex gap-2 opacity-50">
              <div className="h-6 w-10 rounded bg-foreground/10" />
              <div className="h-6 w-10 rounded bg-foreground/10" />
              <div className="h-6 w-10 rounded bg-foreground/10" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
