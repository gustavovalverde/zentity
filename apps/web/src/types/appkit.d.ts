/**
 * Type declarations for Reown AppKit web components.
 * AppKit provides global HTML custom elements for wallet connection.
 */

// biome-ignore lint/style/noNamespace: JSX namespace required for declaring custom HTML elements in TypeScript
declare namespace JSX {
  interface IntrinsicElements {
    "appkit-button": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
    "appkit-network-button": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
    "appkit-connect-button": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
    "appkit-account-button": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
