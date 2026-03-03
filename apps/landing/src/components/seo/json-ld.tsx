export function OrganizationSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Zentity",
    url: "https://zentity.xyz",
    logo: "https://zentity.xyz/favicon.svg",
    description:
      "Cryptographic verification layer using zero-knowledge proofs, fully homomorphic encryption, and credential-wrapped key custody with standards-based OIDC integration.",
    sameAs: [
      "https://github.com/gustavovalverde/zentity",
      "https://x.com/gustavovalverde",
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function SoftwareApplicationSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Zentity",
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description:
      "Cryptographic verification layer that proves compliance without storing personal data. Integrates via standard OAuth 2.1 and OpenID Connect.",
    featureList: [
      "Age verification with zero-knowledge proofs",
      "Document verification with OCR",
      "Liveness detection with multi-gesture challenges",
      "Face matching without biometric storage",
      "Nationality proofs with Merkle trees",
      "Multi-credential encrypted vault",
      "OIDC4VCI and OIDC4VP credential interoperability",
      "Post-quantum ML-KEM-768 encryption",
      "Post-quantum ML-DSA-65 issuer signatures",
      "GDPR-compliant data erasure",
    ],
    license: "https://osaasy.dev/",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function FAQSchema() {
  const faqs = [
    {
      question: "What is Zentity?",
      answer:
        "Zentity is a cryptographic verification layer that proves compliance without collecting the evidence. It uses zero-knowledge proofs, fully homomorphic encryption (FHE), credential-wrapped key custody, and cryptographic commitments to verify identity claims without storing personal data, integrated via standard OAuth 2.1 and OpenID Connect.",
    },
    {
      question: "How does zero-knowledge proof work for age verification?",
      answer:
        "Zero-knowledge proofs allow you to prove you're over a certain age (like 18 or 21) without revealing your actual birthday. Proofs are generated client-side and only proofs and hashes are stored.",
    },
    {
      question: "What happens to my documents after verification?",
      answer:
        "Documents are processed transiently and immediately discarded. Only cryptographic commitments (one-way hashes) are stored, which cannot be reversed to reveal your original data.",
    },
    {
      question: "Can I self-host Zentity?",
      answer:
        "Yes, Zentity can be self-hosted on your own infrastructure with Docker Compose. You maintain full control over your deployment and data.",
    },
    {
      question: "Does Zentity support post-quantum cryptography?",
      answer:
        "Yes. Current architecture includes ML-KEM-768 for selected encryption surfaces and ML-DSA-65 for issuer signing, aligned with NIST post-quantum standards.",
    },
    {
      question: "How does GDPR compliance work?",
      answer:
        "When you delete your account, all identity data is hard-deleted: commitments, encrypted attributes, ZK proofs, and the credential-sealed profile. Without the sealed profile, no one can re-derive the original data. This is equivalent to cryptographic erasure under GDPR.",
    },
  ];

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
