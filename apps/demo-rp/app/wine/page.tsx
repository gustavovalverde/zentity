"use client";

import { useCallback, useState } from "react";
import { DebugPanel } from "@/components/shared/debug-panel";
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
		session,
		isPending,
		isAuthenticated,
		claims,
		isSteppedUp,
		isComplete: isVerified,
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
						: item,
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
					item.wine.id === wineId ? { ...item, quantity } : item,
				),
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
				data-theme="wine"
				className="flex min-h-screen items-center justify-center bg-background"
			>
				<div className="animate-pulse text-muted-foreground">Loading...</div>
			</div>
		);
	}

	if (!isAuthenticated) {
		return (
			<WineAgeGate
				dcrConfig={scenario.dcr}
				providerId={scenario.id}
				onVerify={handleSignIn}
			/>
		);
	}

	if (orderPlaced) {
		return (
			<div
				data-theme="wine"
				className="min-h-screen bg-background font-serif selection:bg-primary/20"
			>
				<WineHeader
					activeTab="cart"
					onTabChange={setActiveTab}
					cartCount={0}
					isVerified={isAuthenticated}
					isSignedIn={isAuthenticated}
					onSignOut={handleSignOut}
				/>
				<main className="mx-auto max-w-7xl px-6 py-12">
					<WineOrderConfirmation
						items={orderedItems}
						claims={claims}
						orderId={orderId}
						onContinueShopping={handleContinueShopping}
					/>
				</main>
				<DebugPanel
					claims={claims}
					session={session}
					notShared={scenario.notShared}
					isComplete={isVerified}
				/>
			</div>
		);
	}

	return (
		<div
			data-theme="wine"
			className="min-h-screen bg-background font-serif selection:bg-primary/20"
		>
			<WineHeader
				activeTab={activeTab}
				onTabChange={setActiveTab}
				cartCount={cartCount}
				isVerified={isAuthenticated}
				isSignedIn={isAuthenticated}
				onSignOut={handleSignOut}
			/>

			<main className="mx-auto max-w-7xl px-6 py-12">
				{activeTab === "browse" ? (
					<div className="animate-in fade-in duration-700 space-y-16">
						<div className="text-center space-y-6 py-12 border-b border-border/40">
							<span className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
								Est. 1928
							</span>
							<h2 className="font-serif text-5xl md:text-6xl font-medium tracking-tight text-foreground">
								Fine Wines <i className="font-serif italic text-primary">&</i>{" "}
								Spirits
							</h2>
							<p className="max-w-xl mx-auto text-lg text-muted-foreground leading-relaxed font-sans">
								Curated selection derived from the world's most exclusive
								vineyards. Sourced responsibly, delivered directly to your
								cellar.
							</p>
						</div>

						<div>
							<div className="flex items-center justify-between mb-8">
								<h3 className="text-xl font-medium tracking-wide">
									Latest Collection
								</h3>
								<button
									type="button"
									className="text-sm font-sans underline decoration-1 underline-offset-4 decoration-primary/50 hover:decoration-primary transition-all"
								>
									View All Regions
								</button>
							</div>
							<WineProductGrid onAddToCart={addToCart} />
						</div>
					</div>
				) : (
					<div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-right-8 duration-500">
						<h2 className="font-serif text-3xl mb-8 border-b pb-4">
							Your Selection
						</h2>
						<WineCart
							items={cart}
							onUpdateQuantity={updateQuantity}
							onRemove={removeFromCart}
							isSteppedUp={isSteppedUp}
							claims={claims}
							onStepUp={handleStepUp}
							onPlaceOrder={handlePlaceOrder}
						/>
					</div>
				)}
			</main>

			<DebugPanel
				claims={claims}
				session={session}
				notShared={scenario.notShared}
				isComplete={isVerified}
			/>

			<footer className="border-t py-12 mt-12 bg-card">
				<div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
					<div>
						<h4 className="font-serif text-lg font-medium mb-4">
							Vino Delivery
						</h4>
						<p className="text-sm text-muted-foreground leading-relaxed">
							Dedicated to sourcing the finest wines <br />
							from reputable growers worldwide.
						</p>
					</div>
					<div className="space-y-2">
						<h4 className="font-serif text-lg font-medium mb-4">Contact</h4>
						<p className="text-sm text-muted-foreground">
							concierge@vinodelivery.com
						</p>
						<p className="text-sm text-muted-foreground">+1 (555) 012-3456</p>
					</div>
					<div className="flex flex-col items-center md:items-end justify-center">
						<span className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
							Verified Merchant
						</span>
						<div className="flex gap-2 opacity-50">
							<div className="h-6 w-10 bg-foreground/10 rounded" />
							<div className="h-6 w-10 bg-foreground/10 rounded" />
							<div className="h-6 w-10 bg-foreground/10 rounded" />
						</div>
					</div>
				</div>
			</footer>
		</div>
	);
}
