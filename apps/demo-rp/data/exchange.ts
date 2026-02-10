export type Holding = {
	symbol: string;
	name: string;
	amount: number;
	price: number;
	change24h: number;
};

export const HOLDINGS: Holding[] = [
	{
		symbol: "BTC",
		name: "Bitcoin",
		amount: 0.4821,
		price: 97_432.5,
		change24h: 2.34,
	},
	{
		symbol: "ETH",
		name: "Ethereum",
		amount: 3.125,
		price: 3_287.8,
		change24h: -1.12,
	},
	{
		symbol: "SOL",
		name: "Solana",
		amount: 45.0,
		price: 187.62,
		change24h: 5.67,
	},
];

export type MarketAsset = {
	symbol: string;
	name: string;
	price: number;
	change24h: number;
	volume: string;
};

export const MARKET_DATA: MarketAsset[] = [
	{
		symbol: "BTC",
		name: "Bitcoin",
		price: 97_432.5,
		change24h: 2.34,
		volume: "$42.1B",
	},
	{
		symbol: "ETH",
		name: "Ethereum",
		price: 3_287.8,
		change24h: -1.12,
		volume: "$18.7B",
	},
	{
		symbol: "SOL",
		name: "Solana",
		price: 187.62,
		change24h: 5.67,
		volume: "$4.2B",
	},
	{
		symbol: "AVAX",
		name: "Avalanche",
		price: 38.45,
		change24h: -0.89,
		volume: "$892M",
	},
	{
		symbol: "DOT",
		name: "Polkadot",
		price: 7.82,
		change24h: 1.23,
		volume: "$412M",
	},
	{
		symbol: "LINK",
		name: "Chainlink",
		price: 18.94,
		change24h: 3.45,
		volume: "$1.1B",
	},
	{
		symbol: "MATIC",
		name: "Polygon",
		price: 0.89,
		change24h: -2.1,
		volume: "$567M",
	},
	{
		symbol: "UNI",
		name: "Uniswap",
		price: 12.34,
		change24h: 0.78,
		volume: "$234M",
	},
];

export function totalPortfolioValue(holdings: Holding[]) {
	return holdings.reduce((sum, h) => sum + h.amount * h.price, 0);
}
