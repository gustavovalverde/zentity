export type DemoScenario = {
  id: "exchange" | "bank";
  title: string;
  subtitle: string;
  requiredClaims: string[];
  purpose: string;
  assurance: "basic" | "full";
  highlight: string;
};

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "exchange",
    title: "Exchange KYC",
    subtitle: "Crypto exchange onboarding + AML screen",
    requiredClaims: [
      "verification_level",
      "verified",
      "document_verified",
      "liveness_verified",
      "age_proof_verified",
      "nationality_proof_verified",
      "face_match_verified",
    ],
    purpose: "Open a trading account and satisfy AML requirements.",
    assurance: "full",
    highlight: "Selective disclosure + status list validation",
  },
  {
    id: "bank",
    title: "Bank Onboarding",
    subtitle: "Account opening + residency verification",
    requiredClaims: [
      "verification_level",
      "verified",
      "document_verified",
      "doc_validity_proof_verified",
      "age_proof_verified",
      "nationality_proof_verified",
    ],
    purpose: "Open a new account with high assurance identity checks.",
    assurance: "full",
    highlight: "OIDC4IDA verified_claims + FHE-backed checks",
  },
];

export function getScenario(id: DemoScenario["id"]) {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === id);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return scenario;
}
