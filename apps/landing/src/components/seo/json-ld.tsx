export function OrganizationSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Zentity",
    url: "https://zentity.xyz",
    logo: "https://zentity.xyz/favicon.svg",
    description:
      "Privacy-preserving identity verification platform using zero-knowledge proofs, homomorphic encryption, and cryptographic commitments.",
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
      "Privacy-first KYC platform using zero-knowledge proofs and homomorphic encryption. Verify identity without storing personal data.",
    featureList: [
      "Age verification with zero-knowledge proofs",
      "Document verification with OCR",
      "Liveness detection with multi-gesture challenges",
      "Face matching without biometric storage",
      "Nationality proofs with Merkle trees",
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
        "Zentity is a privacy-preserving identity verification platform that uses zero-knowledge proofs, homomorphic encryption, and cryptographic commitments to verify identity without storing personal data.",
    },
    {
      question: "How does zero-knowledge proof work for age verification?",
      answer:
        "Zero-knowledge proofs allow you to prove you're over a certain age (like 18 or 21) without revealing your actual birthday. The proof is generated client-side, so your birth date never leaves your device.",
    },
    {
      question: "What happens to my documents after verification?",
      answer:
        "Documents are processed transiently and immediately discarded. Only cryptographic commitments (one-way hashes) are stored, which cannot be reversed to reveal your original data.",
    },
    {
      question: "Is Zentity open source?",
      answer:
        "Yes, Zentity is 100% open source under the O'Saasy license. You can audit every cryptographic operation, self-host on your own infrastructure, or fork and customize for your needs.",
    },
    {
      question: "How does GDPR compliance work?",
      answer:
        "Zentity uses salted hash commitments. When you request data deletion, we delete your salt, which makes all your commitments cryptographically unlinkable—a true 'right to be forgotten.'",
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
