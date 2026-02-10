import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CartItem } from "./wine-cart";

type WineOrderConfirmationProps = {
	items: CartItem[];
	claims?: Record<string, unknown>;
	orderId: string;
	onContinueShopping: () => void;
};

export function WineOrderConfirmation({
	items,
	claims,
	orderId,
	onContinueShopping,
}: WineOrderConfirmationProps) {
	const subtotal = items.reduce(
		(sum, item) => sum + item.wine.price * item.quantity,
		0,
	);
	const tax = subtotal * 0.0875;
	const total = subtotal + tax;

	return (
		<div className="max-w-2xl mx-auto space-y-8 py-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
			<div className="text-center space-y-4">
				<div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success/15">
					<svg
						aria-hidden="true"
						className="size-8 text-success"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M4.5 12.75l6 6 9-13.5"
						/>
					</svg>
				</div>
				<h2 className="font-serif text-3xl font-medium">Order Confirmed</h2>
				<p className="text-muted-foreground">
					Order <span className="font-mono font-medium">#{orderId}</span> has
					been placed.
				</p>
			</div>

			<Card>
				<CardContent className="pt-6 space-y-6">
					{(claims?.given_name != null || claims?.address != null) && (
						<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
							<h4 className="text-sm font-medium text-muted-foreground">
								Delivery Details
							</h4>
							{claims.given_name != null && (
								<p className="text-sm font-medium">
									{String(claims.given_name)} {String(claims.family_name ?? "")}
								</p>
							)}
							{claims.address != null && (
								<p className="text-sm text-muted-foreground">
									{String(claims.address)}
								</p>
							)}
						</div>
					)}

					<div className="space-y-3">
						<h4 className="text-sm font-medium text-muted-foreground">Items</h4>
						<div className="divide-y">
							{items.map(({ wine, quantity }) => (
								<div
									key={wine.id}
									className="flex items-center justify-between py-3"
								>
									<div>
										<p className="font-serif text-sm font-medium">
											{wine.name}
										</p>
										<p className="text-xs text-muted-foreground">
											{wine.vintage} &middot; Qty: {quantity}
										</p>
									</div>
									<span className="font-mono text-sm">
										${(wine.price * quantity).toFixed(2)}
									</span>
								</div>
							))}
						</div>
					</div>

					<div className="border-t pt-4 space-y-2 text-sm">
						<div className="flex justify-between text-muted-foreground">
							<span>Subtotal</span>
							<span className="font-mono">${subtotal.toFixed(2)}</span>
						</div>
						<div className="flex justify-between text-muted-foreground">
							<span>Shipping</span>
							<span className="font-mono text-success">Free</span>
						</div>
						<div className="flex justify-between text-muted-foreground">
							<span>Tax</span>
							<span className="font-mono">${tax.toFixed(2)}</span>
						</div>
						<div className="flex justify-between font-semibold text-base pt-2 border-t">
							<span className="font-serif">Total</span>
							<span className="font-mono">${total.toFixed(2)}</span>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card className="border-dashed bg-muted/20">
				<CardContent className="pt-6 text-center text-sm text-muted-foreground">
					<p>
						Your birthdate was never shared &mdash; only a yes/no proof that
						you&apos;re 21+. Your delivery details were selectively disclosed via
						Zentity and are not stored by Vino Delivery.
					</p>
				</CardContent>
			</Card>

			<Button
				onClick={onContinueShopping}
				variant="outline"
				size="lg"
				className="w-full"
			>
				Continue Shopping
			</Button>
		</div>
	);
}
