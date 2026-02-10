import type { Wine } from "@/data/wine";
import { WINE_CATALOG } from "@/data/wine";
import { WineProductCard } from "./wine-product-card";

type WineProductGridProps = {
	onAddToCart: (wine: Wine) => void;
};

export function WineProductGrid({ onAddToCart }: WineProductGridProps) {
	return (
		<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{WINE_CATALOG.map((wine) => (
				<WineProductCard key={wine.id} wine={wine} onAddToCart={onAddToCart} />
			))}
		</div>
	);
}
