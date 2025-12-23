/**
 * Type declarations for Zama relayer SDK loaded via CDN
 *
 * The Zama provider adapter injects the script and exposes window.relayerSDK.
 */

interface RelayerSDK {
  initSDK: () => Promise<void>;
  createInstance: (config: unknown) => Promise<unknown>;
  SepoliaConfig: unknown;
}

declare global {
  interface Window {
    relayerSDK?: RelayerSDK;
  }
}

export {};
