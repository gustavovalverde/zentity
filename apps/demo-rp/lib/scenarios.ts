export type Scenario = {
	id: string;
	name: string;
	tagline: string;
	description: string;
	providerId: string;
	signInScopes: string[];
	stepUpScopes: string[];
	stepUpClaimKeys: string[];
	stepUpAction?: string;
	dcr: { clientName: string; defaultScopes: string };
	notShared: string[];
};

function buildDcrScopes(
	signInScopes: string[],
	stepUpScopes: string[],
): string {
	return [...new Set([...signInScopes, ...stepUpScopes])].join(" ");
}

export const SCENARIOS: Record<string, Scenario> = {
	bank: (() => {
		const signInScopes = ["openid", "email", "proof:verification"];
		const stepUpScopes = ["identity.name"];
		return {
			id: "bank",
			name: "Velocity Bank",
			tagline: "Modern digital banking",
			description: "Open a current account with verified identity.",
			providerId: "zentity-bank",
			signInScopes,
			stepUpScopes,
			stepUpClaimKeys: ["given_name", "family_name"],
			stepUpAction: "Open Account",
			dcr: {
				clientName: "Velocity Bank",
				defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
			},
			notShared: [
				"Your passport image",
				"Your exact date of birth",
				"Your passport number",
				"Your document expiry date",
			],
		};
	})(),
	exchange: (() => {
		const signInScopes = ["openid", "email", "proof:verification"];
		const stepUpScopes = ["identity.nationality"];
		return {
			id: "exchange",
			name: "Nova Exchange",
			tagline: "Trade crypto globally",
			description: "Complete KYC for trading without document storage.",
			providerId: "zentity-exchange",
			signInScopes,
			stepUpScopes,
			stepUpClaimKeys: ["nationality"],
			stepUpAction: "Start Trading",
			dcr: {
				clientName: "Nova Exchange",
				defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
			},
			notShared: [
				"Your passport image",
				"Your full address",
				"Your document number",
				"Your face photo",
			],
		};
	})(),
	wine: (() => {
		const signInScopes = ["openid", "email", "proof:age"];
		const stepUpScopes = ["identity.name", "identity.address"];
		return {
			id: "wine",
			name: "Vino Delivery",
			tagline: "Fine wine at your door",
			description: "Prove you're 21+ without revealing your birthdate.",
			providerId: "zentity-wine",
			signInScopes,
			stepUpScopes,
			stepUpClaimKeys: ["given_name", "address"],
			stepUpAction: "Complete Purchase",
			dcr: {
				clientName: "Vino Delivery",
				defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
			},
			notShared: [
				"Your exact date of birth",
				"Your document details",
				"Your nationality",
				"Your passport number",
			],
		};
	})(),
	aid: (() => {
		const signInScopes = ["openid", "email", "proof:verification"];
		const stepUpScopes = ["identity.name", "identity.nationality"];
		return {
			id: "aid",
			name: "Relief Global",
			tagline: "Emergency Aid Distribution",
			description:
				"Verify identity to receive aid without exposing sensitive data.",
			providerId: "zentity-aid",
			signInScopes,
			stepUpScopes,
			stepUpClaimKeys: ["given_name", "nationality"],
			stepUpAction: "Claim Aid",
			dcr: {
				clientName: "Relief Global",
				defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
			},
			notShared: [
				"Your biometric data",
				"Your full address history",
				"Your family connections",
				"Your exact location",
			],
		};
	})(),
	veripass: (() => {
		const signInScopes = ["openid", "email", "proof:verification"];
		const stepUpScopes: string[] = [];
		return {
			id: "veripass",
			name: "VeriPass",
			tagline: "Digital Credential Wallet",
			description:
				"Receive a portable credential, then selectively present claims to verifiers.",
			providerId: "zentity-veripass",
			signInScopes,
			stepUpScopes,
			stepUpClaimKeys: [],
			dcr: {
				clientName: "VeriPass Wallet",
				defaultScopes: buildDcrScopes(signInScopes, stepUpScopes),
			},
			notShared: [
				"Your raw biometric data",
				"Your document images",
				"Claims you choose not to disclose",
				"Your full identity to any single verifier",
			],
		};
	})(),
} as const;

export function getScenario(id: string): Scenario {
	const scenario = SCENARIOS[id];
	if (!scenario) {
		throw new Error(`Unknown scenario: ${id}`);
	}
	return scenario;
}
