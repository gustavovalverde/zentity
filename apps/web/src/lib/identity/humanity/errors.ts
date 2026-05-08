import "server-only";

export class HumanityProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Humanity provider not registered: ${providerId}`);
    this.name = "HumanityProviderNotFoundError";
  }
}

/**
 * Provider env or feature flag is missing. Surfaces as 503 Service
 * Unavailable. Provider-specific configuration errors must extend this
 * class so route handlers don't need to know about each provider.
 */
export class HumanityProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HumanityProviderConfigurationError";
  }
}

export class HumanityProviderDisabledError extends HumanityProviderConfigurationError {
  constructor(providerId: string) {
    super(`Humanity provider disabled: ${providerId}`);
    this.name = "HumanityProviderDisabledError";
  }
}

/**
 * Provider rejected a submitted proof. `status` flows back as the HTTP
 * response code so providers can distinguish 400 (bad input) from 502
 * (provider upstream failure). Provider-specific verification errors must
 * extend this class.
 */
export class HumanityProofVerificationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HumanityProofVerificationError";
    this.status = status;
  }
}
