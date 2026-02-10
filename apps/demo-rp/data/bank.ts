export type Product = {
	id: string;
	name: string;
	description: string;
	features: string[];
	cta: string;
};

export const PRODUCTS: Product[] = [
	{
		id: "infinite-card",
		name: "Velocity Infinite Card",
		description:
			"Metal card with unlimited rewards, global lounge access, and dedicated concierge.",
		features: [
			"No foreign transaction fees",
			"Unlimited 2% cashback",
			"Airport lounge access",
			"24/7 concierge service",
		],
		cta: "Apply Now",
	},
	{
		id: "private-checking",
		name: "Private Checking",
		description:
			"Premium checking with no minimums, fee-free global ATM access, and priority support.",
		features: [
			"No monthly fees",
			"Global ATM fee rebates",
			"Early direct deposit",
			"Priority customer support",
		],
		cta: "Open Account",
	},
	{
		id: "wealth-management",
		name: "Wealth Management",
		description:
			"Personalized investment strategies with dedicated advisors and tax-optimized portfolios.",
		features: [
			"Dedicated wealth advisor",
			"Tax-loss harvesting",
			"Alternative investments",
			"Estate planning tools",
		],
		cta: "Get Started",
	},
];

export const BALANCE = 12_450.67;

export type Transaction = {
	id: string;
	merchant: string;
	amount: number;
	date: string;
	category: string;
};

export const TRANSACTIONS: Transaction[] = [
	{
		id: "tx-1",
		merchant: "Whole Foods Market",
		amount: -87.34,
		date: "Feb 5",
		category: "Groceries",
	},
	{
		id: "tx-2",
		merchant: "Netflix",
		amount: -15.99,
		date: "Feb 4",
		category: "Entertainment",
	},
	{
		id: "tx-3",
		merchant: "Salary Deposit",
		amount: 4_200.0,
		date: "Feb 1",
		category: "Income",
	},
	{
		id: "tx-4",
		merchant: "Uber",
		amount: -24.5,
		date: "Jan 31",
		category: "Transport",
	},
	{
		id: "tx-5",
		merchant: "Amazon",
		amount: -142.89,
		date: "Jan 29",
		category: "Shopping",
	},
	{
		id: "tx-6",
		merchant: "Starbucks",
		amount: -6.75,
		date: "Jan 28",
		category: "Food & Drink",
	},
];
