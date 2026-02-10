import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Wine } from "@/data/wine";
import { WINE_TYPE_COLORS } from "@/data/wine";

type WineProductCardProps = {
	wine: Wine;
	onAddToCart: (wine: Wine) => void;
};

function StarRating({ rating }: { rating: number }) {
	const full = Math.floor(rating);
	const half = rating - full >= 0.5;

	return (
		<div className="flex items-center gap-0.5">
			{Array.from({ length: 5 }, (_, i) => (
				<svg
					key={`star-${wine_star_id(i)}`}
					className={`size-3.5 ${i < full ? "text-amber-500" : i === full && half ? "text-amber-400" : "text-muted-foreground/30"}`}
					fill="currentColor"
					viewBox="0 0 20 20"
				>
					<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
				</svg>
			))}
			<span className="ml-1 text-xs text-muted-foreground">{rating}</span>
		</div>
	);
}

function wine_star_id(i: number) {
	return i;
}

export function WineProductCard({ wine, onAddToCart }: WineProductCardProps) {
	return (
		<Card className="group overflow-hidden border-none shadow-sm transition-all hover:shadow-xl hover:-translate-y-1 bg-card">
			<div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary/10">
				<Image
					src={wine.image}
					alt={wine.name}
					fill
					className="object-contain p-6 group-hover:scale-110 transition-transform duration-700 mix-blend-multiply"
				/>
				<div className="absolute bottom-3 left-3">
					<span className="px-2 py-1 bg-background/90 backdrop-blur text-[10px] uppercase tracking-wider font-semibold rounded text-foreground/80 shadow-sm border border-border/50">
						{wine.type}
					</span>
				</div>
			</div>
			<CardContent className="pt-6 px-4 pb-6">
				<div className="mb-4">
					<p className="text-xs text-muted-foreground uppercase tracking-wider text-primary">
						{wine.region}
					</p>
					<h3 className="font-serif text-xl font-medium leading-tight mt-1 group-hover:text-primary transition-colors">
						{wine.name}
					</h3>
					<p className="mt-1 text-sm text-foreground/60 font-serif italic">
						{wine.vintage}
					</p>
				</div>
				<p className="mb-4 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
					{wine.description}
				</p>
				<div className="flex items-center justify-between mt-auto pt-4 border-t border-border/40">
					<span className="text-xl font-serif">${wine.price.toFixed(2)}</span>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onAddToCart(wine)}
						className="rounded-full hover:bg-primary hover:text-primary-foreground border-primary/20"
					>
						Add to Cellar
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
