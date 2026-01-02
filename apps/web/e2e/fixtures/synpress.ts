import { testWithSynpress } from "@synthetixio/synpress";
import { metaMaskFixtures } from "@synthetixio/synpress/playwright";

import hardhatSetup from "../wallet-setup/hardhat.setup";

export const test = testWithSynpress(metaMaskFixtures(hardhatSetup));

// biome-ignore lint/performance/noBarrelFile: Synpress fixture pattern - re-exporting expect for test convenience
export { expect } from "@playwright/test";
