// Import documentation files as raw strings
import architecture from "../../../../docs/architecture.md?raw";
import attestationPrivacy from "../../../../docs/attestation-privacy-architecture.md?raw";
import blockchainSetup from "../../../../docs/blockchain-setup.md?raw";
import cryptographicPillars from "../../../../docs/cryptographic-pillars.md?raw";
import oauthIntegrations from "../../../../docs/oauth-integrations.md?raw";
import passwordSecurity from "../../../../docs/password-security.md?raw";
import ssiArchitecture from "../../../../docs/ssi-architecture.md?raw";
import tamperModel from "../../../../docs/tamper-model.md?raw";
import verification from "../../../../docs/verification.md?raw";
import web3Architecture from "../../../../docs/web3-architecture.md?raw";
import zkArchitecture from "../../../../docs/zk-architecture.md?raw";
import zkNationalityProofs from "../../../../docs/zk-nationality-proofs.md?raw";

interface DocMeta {
  title: string;
  description: string;
  content: string;
}

const docs: Record<string, DocMeta> = {
  architecture: {
    title: "System Architecture",
    description:
      "Overview of how Zentity's services connect and how data flows through the system",
    content: architecture,
  },
  "attestation-privacy": {
    title: "Attestation & Privacy",
    description:
      "Attestation schema, data classification, and privacy boundaries",
    content: attestationPrivacy,
  },
  "cryptographic-pillars": {
    title: "Cryptographic Pillars",
    description:
      "Why we use passkeys, ZK proofs, FHE, and commitments—and how they interlock",
    content: cryptographicPillars,
  },
  "tamper-model": {
    title: "Tamper Model",
    description: "Integrity controls, threat model, and anti-tamper design",
    content: tamperModel,
  },
  "zk-architecture": {
    title: "ZK Architecture",
    description:
      "Zero-knowledge proof system using Noir and UltraHonk for privacy-preserving verification",
    content: zkArchitecture,
  },
  "zk-nationality-proofs": {
    title: "Nationality Proofs",
    description:
      "Privacy-preserving nationality verification using Merkle tree membership proofs",
    content: zkNationalityProofs,
  },
  "password-security": {
    title: "Password Security",
    description:
      "Argon2id password hashing implementation and security considerations",
    content: passwordSecurity,
  },
  "ssi-architecture": {
    title: "SSI Architecture",
    description:
      "Self-Sovereign Identity through verifiable credentials, selective disclosure, and non-custodial key custody",
    content: ssiArchitecture,
  },
  "web3-architecture": {
    title: "Web3 Architecture",
    description:
      "fhEVM module, encryption/decryption flows, and on-chain attestations",
    content: web3Architecture,
  },
  "oauth-integrations": {
    title: "OAuth Integrations",
    description:
      "OAuth and identity integration guidance for relying party applications",
    content: oauthIntegrations,
  },
  "blockchain-setup": {
    title: "Blockchain Setup",
    description: "FHEVM network config, envs, faucets, and deployments",
    content: blockchainSetup,
  },
  verification: {
    title: "Deployment Verification",
    description:
      "How to verify that deployed services match the public source code",
    content: verification,
  },
};

export const docsNav = [
  {
    title: "Start Here",
    items: [
      { title: "System Overview", slug: "architecture" },
      { title: "Cryptographic Pillars", slug: "cryptographic-pillars" },
      { title: "Attestation & Privacy", slug: "attestation-privacy" },
      { title: "Tamper Model", slug: "tamper-model" },
    ],
  },
  {
    title: "Cryptography",
    items: [
      { title: "ZK Architecture", slug: "zk-architecture" },
      { title: "Nationality Proofs", slug: "zk-nationality-proofs" },
      { title: "Password Security", slug: "password-security" },
    ],
  },
  {
    title: "Web3",
    items: [
      { title: "Web3 Architecture", slug: "web3-architecture" },
      { title: "Blockchain Setup", slug: "blockchain-setup" },
    ],
  },
  {
    title: "Integration",
    items: [
      { title: "OAuth Integrations", slug: "oauth-integrations" },
      { title: "SSI Architecture", slug: "ssi-architecture" },
    ],
  },
  {
    title: "Trust & Verification",
    items: [{ title: "Deployment Verification", slug: "verification" }],
  },
];

const SLUG_SET = new Set(Object.keys(docs));

export function getDocBySlug(slug: string): DocMeta | undefined {
  return docs[slug];
}

export function hasDocSlug(slug: string): boolean {
  return SLUG_SET.has(slug);
}

export function getAllDocSlugs(): string[] {
  return [...SLUG_SET];
}
