export interface Product {
  brand: string;
  id: string;
  name: string;
  price: number;
  rating: number;
  snippet: string;
}

export interface ShoppingTask {
  budget: number;
  id: string;
  label: string;
  pick: string;
  prompt: string;
  results: Product[];
  scope?: string;
}

export const SHOPPING_TASKS: ShoppingTask[] = [
  {
    id: "headphones",
    label: "Wireless headphones",
    prompt: "Find me the best wireless noise-cancelling headphones under $400",
    budget: 400,
    results: [
      {
        id: "p-1",
        name: "WH-1000XM5",
        brand: "Sony",
        price: 348,
        rating: 4.8,
        snippet:
          "Industry-leading noise cancellation, 30h battery, multipoint.",
      },
      {
        id: "p-2",
        name: "AirPods Max",
        brand: "Apple",
        price: 399,
        rating: 4.6,
        snippet: "Premium build, spatial audio, seamless Apple ecosystem.",
      },
      {
        id: "p-3",
        name: "QuietComfort Ultra",
        brand: "Bose",
        price: 379,
        rating: 4.7,
        snippet: "CustomTune sound, immersive audio, plush comfort.",
      },
    ],
    pick: "p-1",
  },
  {
    id: "spirits",
    label: "Premium spirits",
    prompt: "Find me a premium whisky bottle as a gift, budget $150",
    budget: 150,
    scope: "openid proof:age proof:nationality identity.name identity.address",
    results: [
      {
        id: "p-4",
        name: "The Macallan 18 Double Cask",
        brand: "Macallan",
        price: 149,
        rating: 4.9,
        snippet:
          "Sherry-seasoned oak, rich dried fruit, warm spice. Gift-box included.",
      },
      {
        id: "p-5",
        name: "Yamazaki 12 Year",
        brand: "Suntory",
        price: 129,
        rating: 4.8,
        snippet:
          "Japanese single malt, peach and coconut notes, Mizunara oak finish.",
      },
      {
        id: "p-6",
        name: "Lagavulin 16 Year",
        brand: "Lagavulin",
        price: 89,
        rating: 4.7,
        snippet:
          "Islay classic, intense peat smoke, maritime salt, long dry finish.",
      },
    ],
    pick: "p-4",
  },
  {
    id: "sneakers",
    label: "Running shoes",
    prompt: "Find me the best running shoes for daily training under $200",
    budget: 200,
    results: [
      {
        id: "p-7",
        name: "Pegasus 41",
        brand: "Nike",
        price: 140,
        rating: 4.6,
        snippet: "ReactX foam, breathable mesh, versatile daily trainer.",
      },
      {
        id: "p-8",
        name: "Ghost 16",
        brand: "Brooks",
        price: 150,
        rating: 4.7,
        snippet: "DNA LOFT v2 cushioning, smooth transitions, neutral ride.",
      },
      {
        id: "p-9",
        name: "Fresh Foam X 1080v13",
        brand: "New Balance",
        price: 165,
        rating: 4.8,
        snippet: "Plush cushioning, Hypoknit upper, premium comfort.",
      },
    ],
    pick: "p-9",
  },
];
