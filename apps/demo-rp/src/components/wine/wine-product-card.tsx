import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Wine } from "@/data/wine";

interface WineProductCardProps {
  onAddToCart: (wine: Wine) => void;
  wine: Wine;
}

function _StarRating({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;

  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          className={`size-3.5 ${i < full ? "text-amber-500" : i === full && half ? "text-amber-400" : "text-muted-foreground/30"}`}
          fill="currentColor"
          key={`star-${wine_star_id(i)}`}
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      <span className="ml-1 text-muted-foreground text-xs">{rating}</span>
    </div>
  );
}

function wine_star_id(i: number) {
  return i;
}

export function WineProductCard({ wine, onAddToCart }: WineProductCardProps) {
  return (
    <Card className="group overflow-hidden border-none bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary/10">
        <Image
          alt={wine.name}
          className="object-contain p-6 mix-blend-multiply transition-transform duration-700 group-hover:scale-110"
          fill
          src={wine.image}
        />
        <div className="absolute bottom-3 left-3">
          <span className="rounded border border-border/50 bg-background/90 px-2 py-1 font-semibold text-[10px] text-foreground/80 uppercase tracking-wider shadow-sm backdrop-blur">
            {wine.type}
          </span>
        </div>
      </div>
      <CardContent className="px-4 pt-6 pb-6">
        <div className="mb-4">
          <p className="text-muted-foreground text-primary text-xs uppercase tracking-wider">
            {wine.region}
          </p>
          <h3 className="mt-1 font-medium font-serif text-xl leading-tight transition-colors group-hover:text-primary">
            {wine.name}
          </h3>
          <p className="mt-1 font-serif text-foreground/60 text-sm italic">
            {wine.vintage}
          </p>
        </div>
        <p className="mb-4 line-clamp-2 text-muted-foreground text-sm leading-relaxed">
          {wine.description}
        </p>
        <div className="mt-auto flex items-center justify-between border-border/40 border-t pt-4">
          <span className="font-serif text-xl">${wine.price.toFixed(2)}</span>
          <Button
            className="rounded-full border-primary/20 hover:bg-primary hover:text-primary-foreground"
            onClick={() => onAddToCart(wine)}
            size="sm"
            variant="outline"
          >
            Add to Cellar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
