export type Wine = {
	id: string;
	name: string;
	vintage: number;
	region: string;
	type: "red" | "white" | "rosé" | "sparkling";
	price: number;
	rating: number;
	description: string;
	image: string;
};

export const WINE_CATALOG: Wine[] = [
	{
		id: "w-1",
		name: "Château Margaux",
		vintage: 2018,
		region: "Bordeaux, France",
		type: "red",
		price: 89.0,
		rating: 4.8,
		description: "Complex layers of dark fruit, violet, and mineral notes.",
		image: "/wine/red.png",
	},
	{
		id: "w-2",
		name: "Cloudy Bay Sauvignon Blanc",
		vintage: 2022,
		region: "Marlborough, NZ",
		type: "white",
		price: 24.0,
		rating: 4.3,
		description: "Crisp citrus and tropical fruit with a zesty finish.",
		image: "/wine/white.png",
	},
	{
		id: "w-3",
		name: "Whispering Angel",
		vintage: 2023,
		region: "Côtes de Provence",
		type: "rosé",
		price: 22.0,
		rating: 4.1,
		description: "Elegant pale rosé with fresh red berry and floral notes.",
		image: "/wine/rose.png",
	},
	{
		id: "w-4",
		name: "Opus One",
		vintage: 2019,
		region: "Napa Valley, USA",
		type: "red",
		price: 425.0,
		rating: 4.9,
		description: "Iconic blend with cassis, espresso, and dark chocolate.",
		image: "/wine/red.png",
	},
	{
		id: "w-5",
		name: "Veuve Clicquot Brut",
		vintage: 2020,
		region: "Champagne, France",
		type: "sparkling",
		price: 58.0,
		rating: 4.5,
		description: "Golden bubbles with brioche, apple, and toasted almond.",
		image: "/wine/sparkling.png",
	},
	{
		id: "w-6",
		name: "Penfolds Grange",
		vintage: 2017,
		region: "South Australia",
		type: "red",
		price: 310.0,
		rating: 4.7,
		description: "Powerful shiraz with dark plum, spice, and oak vanillin.",
		image: "/wine/red.png",
	},
	{
		id: "w-7",
		name: "Chablis Premier Cru",
		vintage: 2021,
		region: "Burgundy, France",
		type: "white",
		price: 42.0,
		rating: 4.4,
		description: "Steely minerality with green apple and a flinty finish.",
		image: "/wine/white.png",
	},
	{
		id: "w-8",
		name: "Barolo Riserva",
		vintage: 2016,
		region: "Piedmont, Italy",
		type: "red",
		price: 78.0,
		rating: 4.6,
		description: "Nebbiolo at its finest — tar, roses, and dried cherry.",
		image: "/wine/red.png",
	},
	{
		id: "w-9",
		name: "Dom Pérignon",
		vintage: 2013,
		region: "Champagne, France",
		type: "sparkling",
		price: 289.0,
		rating: 4.9,
		description: "Legendary prestige cuvée with citrus, smoke, and depth.",
		image: "/wine/sparkling.png",
	},
	{
		id: "w-10",
		name: "Sancerre Blanc",
		vintage: 2022,
		region: "Loire Valley, France",
		type: "white",
		price: 28.0,
		rating: 4.2,
		description:
			"Pure expression of sauvignon blanc with gooseberry and chalk.",
		image: "/wine/white.png",
	},
];

export const WINE_TYPE_COLORS: Record<Wine["type"], string> = {
	red: "#722F37",
	white: "#F5E6CA",
	rosé: "#F4A7BB",
	sparkling: "#F0D68A",
};
