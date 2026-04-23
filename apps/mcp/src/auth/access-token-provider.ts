import { TokenExpiredError as FirstPartyTokenExpiredError } from "@zentity/sdk/fpa";
import { config } from "../config.js";
import type { DpopKeyPair } from "./dpop.js";
import { ensureFirstPartyAuth } from "./first-party-auth.js";

const TokenExpiredError = FirstPartyTokenExpiredError;

export { TokenExpiredError };

export class AccessTokenProvider {
  private readonly clientId: string;
  private readonly resource: string | undefined;

  constructor(
    _tokenEndpoint: string,
    _dpopKey: DpopKeyPair,
    clientId: string,
    resource?: string
  ) {
    this.clientId = clientId;
    this.resource = resource;
  }

  getAccessToken(): Promise<string> {
    return ensureFirstPartyAuth(config.zentityUrl).getAccessToken({
      clientId: this.clientId,
      ...(this.resource ? { resource: this.resource } : {}),
    });
  }
}
