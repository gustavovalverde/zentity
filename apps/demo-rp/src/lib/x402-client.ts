import { x402HTTPClient, x402Client } from "@x402/core/client";
import type { ClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { Account, Chain, Transport, WalletClient } from "viem";

const NETWORK = "eip155:84532";

export function createX402PaymentClient(
  walletClient: WalletClient<Transport, Chain, Account>
) {
  const signer: ClientEvmSigner = {
    address: walletClient.account.address,
    signTypedData: (message) =>
      walletClient.signTypedData({
        ...message,
        account: walletClient.account,
      }),
  };
  const client = new x402Client();
  client.register(NETWORK, new ExactEvmScheme(signer));

  const httpClient = new x402HTTPClient(client);
  return { client, httpClient };
}
