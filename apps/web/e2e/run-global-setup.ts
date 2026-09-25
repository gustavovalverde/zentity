import globalSetup from "./global-setup";

const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? "http://localhost:3100";

const config: Parameters<typeof globalSetup>[0] = {
  projects: [
    {
      use: {
        baseURL,
      },
    },
  ],
};

await globalSetup(config);
