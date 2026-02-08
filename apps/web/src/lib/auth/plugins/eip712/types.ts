export interface Eip712TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface BuildTypedDataParams {
  address: string;
  chainId: number;
  nonce: string;
}

export interface Eip712AuthOptions {
  appName?: string;
  emailDomainName?: string;
  nonceTtlSeconds?: number;
  buildTypedData?: (params: BuildTypedDataParams) => Eip712TypedData;
}
