import { createConfig, http } from "wagmi";
import { baseSepolia, hardhat, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [baseSepolia, hardhat, sepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(),
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [sepolia.id]: http(),
  },
  ssr: true,
});
