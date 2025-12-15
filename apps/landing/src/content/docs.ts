// Import documentation files as raw strings
import architecture from "../../../../docs/architecture.md?raw";
import passwordSecurity from "../../../../docs/password-security.md?raw";
import rpRedirectFlow from "../../../../docs/rp-redirect-flow.md?raw";
import zkArchitecture from "../../../../docs/zk-architecture.md?raw";
import zkNationalityProofs from "../../../../docs/zk-nationality-proofs.md?raw";

export interface DocMeta {
  title: string;
  description: string;
  content: string;
}

export const docs: Record<string, DocMeta> = {
  architecture: {
    title: "System Architecture",
    description:
      "Overview of how Zentity's services connect and how data flows through the system",
    content: architecture,
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
  "rp-redirect-flow": {
    title: "RP Redirect Flow",
    description:
      "OAuth-style redirect flow for third-party relying party integrations",
    content: rpRedirectFlow,
  },
};

export const docsNav = [
  {
    title: "Architecture",
    items: [
      { title: "System Overview", slug: "architecture" },
      { title: "ZK Architecture", slug: "zk-architecture" },
    ],
  },
  {
    title: "Cryptography",
    items: [
      { title: "Nationality Proofs", slug: "zk-nationality-proofs" },
      { title: "Password Security", slug: "password-security" },
    ],
  },
  {
    title: "Integration",
    items: [{ title: "RP Redirect Flow", slug: "rp-redirect-flow" }],
  },
];

export function getDocBySlug(slug: string): DocMeta | undefined {
  return docs[slug];
}

export function getAllDocSlugs(): string[] {
  return Object.keys(docs);
}
