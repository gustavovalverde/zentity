import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { x402HTTPClient as X402HTTP, x402Client } from "@x402/fetch";
import type { Account, Chain, Transport, WalletClient } from "viem";

const NETWORK = "eip155:84532";

export function createX402PaymentClient(
  walletClient: WalletClient<Transport, Chain, Account>
) {
  // toClientEvmSigner expects `signer.address` at the top level,
  // but wagmi's WalletClient has it at `account.address`.
  const signerCompat = Object.assign(Object.create(walletClient), {
    address: walletClient.account.address,
  });
  const signer = toClientEvmSigner(signerCompat as never);
  const client = new x402Client();
  client.register(NETWORK, new ExactEvmScheme(signer));

  const httpClient = new X402HTTP(client);
  return { client, httpClient };
}
