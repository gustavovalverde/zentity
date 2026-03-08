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
    id: "espresso",
    label: "Espresso machine",
    prompt: "Find me a great espresso machine for home under $800",
    budget: 800,
    results: [
      {
        id: "p-4",
        name: "Bambino Plus",
        brand: "Breville",
        price: 499,
        rating: 4.7,
        snippet: "Auto milk texturing, fast heat-up, compact footprint.",
      },
      {
        id: "p-5",
        name: "Specialista Arte",
        brand: "De'Longhi",
        price: 599,
        rating: 4.5,
        snippet: "Built-in grinder, smart tamping, sensor grinding tech.",
      },
      {
        id: "p-6",
        name: "Classic Pro",
        brand: "Gaggia",
        price: 449,
        rating: 4.6,
        snippet: "Commercial steam wand, 58mm portafilter, prosumer build.",
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
