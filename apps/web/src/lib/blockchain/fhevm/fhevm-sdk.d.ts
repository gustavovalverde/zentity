/**
 * Type declarations for Zama relayer SDK loaded via CDN
 *
 * The Zama provider adapter injects the script and exposes globalThis.window.relayerSDK.
 */

interface RelayerSDK {
  createInstance: (config: unknown) => Promise<unknown>;
  initSDK: () => Promise<void>;
  MainnetConfig: unknown;
  SepoliaConfig: unknown;
}

declare global {
  interface Window {
    relayerSDK?: RelayerSDK;
  }
}

export {};
