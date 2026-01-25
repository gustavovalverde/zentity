import type { FhevmProviderFactory } from "..";

export const createMockInstance: FhevmProviderFactory = async ({
  chainId,
  rpcUrl,
}) => {
  if (!rpcUrl) {
    throw new Error("Mock FHEVM provider requires a rpcUrl");
  }

  // Dynamic import keeps mock-utils out of production bundle
  const { MockFhevmInstance, contracts } = await import("@fhevm/mock-utils");
  const { JsonRpcProvider } = await import("ethers");

  const provider = new JsonRpcProvider(rpcUrl);

  // The @fhevm/hardhat-plugin exposes this RPC method with deployed contract addresses
  const metadata = (await provider.send("fhevm_relayer_metadata", [])) as {
    ACLAddress: `0x${string}`;
    InputVerifierAddress: `0x${string}`;
    KMSVerifierAddress: `0x${string}`;
  };

  const [inputVerifier, kmsVerifier] = await Promise.all([
    contracts.InputVerifier.create(provider, metadata.InputVerifierAddress),
    contracts.KMSVerifier.create(provider, metadata.KMSVerifierAddress),
  ]);

  const inputDomain = inputVerifier.inputVerifierProperties.eip712Domain;
  const kmsDomain = kmsVerifier.kmsVerifierProperties.eip712Domain;
  if (!(inputDomain && kmsDomain)) {
    throw new Error("Missing EIP-712 domain info for mock relayer");
  }

  const instance = await MockFhevmInstance.create(
    provider,
    provider,
    {
      aclContractAddress: metadata.ACLAddress,
      chainId,
      gatewayChainId: Number(inputDomain.chainId),
      inputVerifierContractAddress: metadata.InputVerifierAddress,
      kmsContractAddress: metadata.KMSVerifierAddress,
      verifyingContractAddressDecryption:
        kmsDomain.verifyingContract as `0x${string}`,
      verifyingContractAddressInputVerification:
        inputDomain.verifyingContract as `0x${string}`,
    },
    {
      inputVerifierProperties: inputVerifier.inputVerifierProperties,
      kmsVerifierProperties: kmsVerifier.kmsVerifierProperties,
    }
  );

  return instance;
};
