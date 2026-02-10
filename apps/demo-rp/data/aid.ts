export type Program = {
	id: string;
	name: string;
	description: string;
	status: "active" | "upcoming";
};

export const PROGRAMS: Program[] = [
	{
		id: "food-shelter",
		name: "Emergency Food & Shelter",
		description: "Weekly food rations and temporary shelter access.",
		status: "active",
	},
	{
		id: "medical",
		name: "Medical Assistance",
		description: "Basic healthcare and prescription support.",
		status: "active",
	},
	{
		id: "education",
		name: "Education Support",
		description: "School supplies and tutoring for children.",
		status: "upcoming",
	},
];

export type Collection = {
	id: string;
	date: string;
	program: string;
	location: string;
};

export const COLLECTION_HISTORY: Collection[] = [
	{
		id: "col-1",
		date: "Feb 8, 2026",
		program: "Emergency Food & Shelter",
		location: "Central Community Center",
	},
	{
		id: "col-2",
		date: "Feb 1, 2026",
		program: "Emergency Food & Shelter",
		location: "Central Community Center",
	},
	{
		id: "col-3",
		date: "Jan 25, 2026",
		program: "Medical Assistance",
		location: "Mobile Unit (North)",
	},
];
