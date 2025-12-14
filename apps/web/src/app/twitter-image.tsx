import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Zentity - Prove everything. Reveal nothing.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
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

      {/* Main content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          padding: "60px",
          gap: "32px",
        }}
      >
        {/* Logo mark - Z in circle */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100px",
            height: "100px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)",
          }}
        >
          <span
            style={{
              fontSize: "56px",
              fontWeight: 700,
              color: "#ffffff",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            Z
          </span>
        </div>

        {/* Brand name */}
        <span
          style={{
            fontSize: "32px",
            fontWeight: 500,
            color: "#a1a1aa",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
          }}
        >
          Zentity
        </span>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "64px",
              fontWeight: 700,
              color: "#ffffff",
              lineHeight: 1.1,
            }}
          >
            Prove everything.
          </span>
          <span
            style={{
              fontSize: "64px",
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
            fontSize: "24px",
            color: "#71717a",
            marginTop: "16px",
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
            fontSize: "18px",
            color: "#52525b",
          }}
        >
          zentity.xyz
        </span>
      </div>
    </div>,
    {
      ...size,
    },
  );
}
