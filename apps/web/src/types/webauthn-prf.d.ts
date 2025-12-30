export {};

declare global {
  interface AuthenticationExtensionsClientInputs {
    prf?: {
      eval?: {
        first: BufferSource;
        second?: BufferSource;
      };
      evalByCredential?: Record<string, BufferSource>;
    };
  }

  interface AuthenticationExtensionsClientOutputs {
    prf?: {
      enabled?: boolean;
      results?: {
        first?: ArrayBuffer;
        second?: ArrayBuffer;
      };
      resultsByCredential?: Record<string, ArrayBuffer>;
    };
  }
}
