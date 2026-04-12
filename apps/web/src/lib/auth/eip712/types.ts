export interface Eip712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  message: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
}

export interface BuildTypedDataParams {
  address: string;
  chainId: number;
  nonce: string;
}

export interface Eip712AuthOptions {
  appName?: string;
  buildTypedData?: (params: BuildTypedDataParams) => Eip712TypedData;
  emailDomainName?: string;
  nonceTtlSeconds?: number;
}
