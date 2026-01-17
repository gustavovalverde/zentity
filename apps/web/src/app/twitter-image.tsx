import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Zentity - Prove everything. Reveal nothing.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

export default async function Image() {
  // Fetch the actual brand logo (transparent version) from static bundle
  const logoBuffer = await fetch(
    new URL(
      "../../public/images/logo/logo-full-dark-transparent.png",
      import.meta.url
    )
  ).then((res) => res.arrayBuffer());

  // Convert to base64 data URL for Satori renderer
  const logoDataUrl = `data:image/png;base64,${arrayBufferToBase64(logoBuffer)}`;

  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0a0a0a",
        position: "relative",
      }}
    >
      {/* Subtle gradient overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "radial-gradient(ellipse at 30% 20%, rgba(124, 58, 237, 0.15) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(6, 182, 212, 0.1) 0%, transparent 50%)",
          display: "flex",
        }}
      />

      {/* Subtle noise texture overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          opacity: 0.03,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
          display: "flex",
        }}
      />

      {/* Main content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          padding: "60px",
          gap: "24px",
        }}
      >
        {/* Actual brand logo */}
        {/* biome-ignore lint/a11y/useAltText: OG images use Satori renderer which doesn't render alt text */}
        {/* biome-ignore lint/performance/noImgElement: Satori only supports basic HTML img elements */}
        <img
          height={250}
          src={logoDataUrl}
          style={{
            objectFit: "contain",
          }}
          width={460}
        />

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            marginTop: "24px",
          }}
        >
          <span
            style={{
              fontSize: "56px",
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
            }}
          >
            Prove everything.
          </span>
          <span
            style={{
              fontSize: "56px",
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
            }}
          >
            Reveal nothing.
          </span>
        </div>

        {/* Subtext */}
        <span
          style={{
            fontSize: "22px",
            color: "#a1a1aa",
            marginTop: "8px",
          }}
        >
          Privacy-First Identity Verification
        </span>
      </div>

      {/* Bottom gradient bar */}
      <div
        style={{
          height: "8px",
          width: "100%",
          background: "linear-gradient(90deg, #7c3aed 0%, #06b6d4 100%)",
          display: "flex",
        }}
      />

      {/* URL badge */}
      <div
        style={{
          position: "absolute",
          bottom: "32px",
          right: "48px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "20px",
            color: "#9ca3af",
          }}
        >
          zentity.xyz
        </span>
      </div>
    </div>,
    {
      ...size,
    }
  );
}
