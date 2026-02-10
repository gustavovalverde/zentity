import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Wine } from "@/data/wine";

type CartItem = {
	wine: Wine;
	quantity: number;
};

type WineCartProps = {
	items: CartItem[];
	onUpdateQuantity: (wineId: string, quantity: number) => void;
	onRemove: (wineId: string) => void;
	isSteppedUp: boolean;
	claims?: Record<string, unknown>;
	onStepUp: () => void;
	onPlaceOrder: () => void;
};

export function WineCart({
	items,
	onUpdateQuantity,
	onRemove,
	isSteppedUp,
	claims,
	onStepUp,
	onPlaceOrder,
}: WineCartProps) {
	const subtotal = items.reduce(
		(sum, item) => sum + item.wine.price * item.quantity,
		0,
	);
	const tax = subtotal * 0.0875;
	const total = subtotal + tax;

	if (items.length === 0) {
		return (
			<div className="mx-auto max-w-lg py-16 text-center">
				<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
					<svg
						aria-hidden="true"
						className="size-8 text-muted-foreground"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={1.5}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
						/>
					</svg>
				</div>
				<h3 className="font-serif text-lg font-semibold">Cart is empty</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Browse our collection and add wines to your cart.
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="font-serif text-base">Your Cart</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="divide-y">
						{items.map(({ wine, quantity }) => (
							<div key={wine.id} className="flex items-center gap-4 py-4">
								<div className="flex-1">
									<p className="font-serif text-sm font-medium">{wine.name}</p>
									<p className="text-xs text-muted-foreground">
										{wine.vintage} &middot; {wine.region}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() =>
											onUpdateQuantity(wine.id, Math.max(0, quantity - 1))
										}
										className="flex size-7 items-center justify-center rounded border text-sm hover:bg-muted"
									>
										-
									</button>
									<span className="w-8 text-center font-mono text-sm">
										{quantity}
									</span>
									<button
										type="button"
										onClick={() => onUpdateQuantity(wine.id, quantity + 1)}
										className="flex size-7 items-center justify-center rounded border text-sm hover:bg-muted"
									>
										+
									</button>
								</div>
								<span className="w-20 text-right font-mono text-sm font-medium">
									${(wine.price * quantity).toFixed(2)}
								</span>
								<button
									type="button"
									onClick={() => onRemove(wine.id)}
									className="text-muted-foreground hover:text-foreground"
								>
									<svg
										aria-hidden="true"
										className="size-4"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={2}
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
								</button>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{isSteppedUp && (
				<Card>
					<CardContent className="pt-6 space-y-4">
						{(claims?.given_name != null || claims?.address != null) && (
							<div className="space-y-2 rounded-lg border bg-muted/30 p-4">
								<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
									Ship To
								</h4>
								{claims.given_name != null && (
									<p className="text-sm font-medium">
										{String(claims.given_name)}{" "}
										{String(claims.family_name ?? "")}
									</p>
								)}
								{claims.address != null && (
									<p className="text-sm text-muted-foreground">
										{String(claims.address)}
									</p>
								)}
							</div>
						)}

						<div className="space-y-2 rounded-lg border bg-muted/30 p-4">
							<h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Payment
							</h4>
							<p className="text-sm font-medium font-mono">
								**** **** **** 1234
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardContent className="pt-6">
					<div className="space-y-2 text-sm">
						<div className="flex justify-between text-muted-foreground">
							<span>Subtotal</span>
							<span className="font-mono">${subtotal.toFixed(2)}</span>
						</div>
						<div className="flex justify-between text-muted-foreground">
							<span>Shipping</span>
							<span className="font-mono text-success">Free</span>
						</div>
						{isSteppedUp && (
							<div className="flex justify-between text-muted-foreground">
								<span>Tax</span>
								<span className="font-mono">${tax.toFixed(2)}</span>
							</div>
						)}
						<div className="flex justify-between font-semibold text-base pt-2 border-t">
							<span className="font-serif">
								{isSteppedUp ? "Total" : "Subtotal"}
							</span>
							<span className="font-mono">
								${isSteppedUp ? total.toFixed(2) : subtotal.toFixed(2)}
							</span>
						</div>
					</div>

					{isSteppedUp ? (
						<Button className="mt-4 w-full" size="lg" onClick={onPlaceOrder}>
							Place Order
						</Button>
					) : (
						<Button className="mt-4 w-full" size="lg" onClick={onStepUp}>
							Verify Delivery Details to Checkout
						</Button>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export type { CartItem };
