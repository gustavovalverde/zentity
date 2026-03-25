import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Zentity",
    short_name: "Zentity",
    description: "Privacy-first identity verification",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/images/logo/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/images/logo/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Pending Approvals",
        url: "/dashboard/agents",
        icons: [
          {
            src: "/images/logo/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
