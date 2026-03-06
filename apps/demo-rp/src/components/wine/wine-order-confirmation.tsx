import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CartItem } from "./wine-cart";

interface WineOrderConfirmationProps {
  claims?: Record<string, unknown>;
  items: CartItem[];
  onContinueShopping: () => void;
  orderId: string;
}

export function WineOrderConfirmation({
  items,
  claims,
  orderId,
  onContinueShopping,
}: WineOrderConfirmationProps) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.wine.price * item.quantity,
    0
  );
  const tax = subtotal * 0.0875;
  const total = subtotal + tax;

  return (
    <div className="fade-in slide-in-from-bottom-4 mx-auto max-w-2xl animate-in space-y-8 py-8 duration-700">
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success/15">
          <svg
            aria-hidden="true"
            className="size-8 text-success"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M4.5 12.75l6 6 9-13.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="font-medium font-serif text-3xl">Order Confirmed</h2>
        <p className="text-muted-foreground">
          Order <span className="font-medium font-mono">#{orderId}</span> has
          been placed.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-6 pt-6">
          {(claims?.given_name != null || claims?.address != null) && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <h4 className="font-medium text-muted-foreground text-sm">
                Delivery Details
              </h4>
              {claims.given_name != null && (
                <p className="font-medium text-sm">
                  {String(claims.given_name)} {String(claims.family_name ?? "")}
                </p>
              )}
              {claims.address != null && (
                <p className="text-muted-foreground text-sm">
                  {String(claims.address)}
                </p>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h4 className="font-medium text-muted-foreground text-sm">Items</h4>
            <div className="divide-y">
              {items.map(({ wine, quantity }) => (
                <div
                  className="flex items-center justify-between py-3"
                  key={wine.id}
                >
                  <div>
                    <p className="font-medium font-serif text-sm">
                      {wine.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
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

          <div className="space-y-2 border-t pt-4 text-sm">
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
            <div className="flex justify-between border-t pt-2 font-semibold text-base">
              <span className="font-serif">Total</span>
              <span className="font-mono">${total.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed bg-muted/20">
        <CardContent className="space-y-3 pt-6 text-center text-muted-foreground text-sm">
          <p className="font-medium text-foreground text-xs uppercase tracking-wider">
            Double Anonymity
          </p>
          <p>
            Your birthdate was never shared &mdash; only a yes/no proof that
            you&apos;re 18+. Delivery details were selectively disclosed and are
            not stored by Vino Delivery.
          </p>
          <div className="flex flex-col gap-1 text-xs">
            <span>Vino Delivery never learned your real identity</span>
            <span>
              The verification provider never learned which site you visited
            </span>
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        onClick={onContinueShopping}
        size="lg"
        variant="outline"
      >
        Continue Shopping
      </Button>
    </div>
  );
}
