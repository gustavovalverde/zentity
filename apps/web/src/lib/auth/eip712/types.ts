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
