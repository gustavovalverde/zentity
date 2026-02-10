import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: [
		// Native addon — must not be bundled by Turbopack
		"better-sqlite3",
	],
};

export default nextConfig;
