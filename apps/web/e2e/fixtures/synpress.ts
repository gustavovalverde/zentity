import { testWithSynpress } from "@synthetixio/synpress";
import { metaMaskFixtures } from "@synthetixio/synpress/playwright";

import hardhatSetup from "../wallet-setup/hardhat.setup";

export const test = testWithSynpress(metaMaskFixtures(hardhatSetup));

export { expect } from "@playwright/test";
