import {
  IconCircleCheck,
  IconCpu,
  IconDatabase,
  IconDeviceDesktop,
  IconFileCode,
  IconFingerprint,
  IconKey,
  IconLink,
  IconLock,
  IconServer,
  IconShieldCheck,
} from "@tabler/icons-react";

import { SectionHeader } from "@/components/landing/section-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { colorStyles } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function TechnicalDeepDive() {
  return (
    <section
      className="landing-section landing-band-flat border-border/50 border-y"
      id="architecture"
    >
      <div className="landing-container">
        <SectionHeader
          title="Technical Deep Dive"
          subtitle="Core flows, trust boundaries, and disclosure paths"
        />

        <div>
          <Tabs defaultValue="dataflow" className="w-full">
            {/* Pill-shaped Tabs */}
            <div className="mb-12 flex justify-center">
              <TabsList className="h-auto w-fit flex-wrap justify-center gap-1 rounded-2xl border border-border bg-muted p-1 md:rounded-full">
                <TabsTrigger
                  value="dataflow"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  Data Flow
                </TabsTrigger>
                <TabsTrigger
                  value="keycustody"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  Key Custody
                </TabsTrigger>
                <TabsTrigger
                  value="credentials"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  Credentials
                </TabsTrigger>
                <TabsTrigger
                  value="fhe"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  FHE
                </TabsTrigger>
                <TabsTrigger
                  value="circuits"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  ZK Circuits
                </TabsTrigger>
                <TabsTrigger
                  value="architecture"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  Architecture
                </TabsTrigger>
                <TabsTrigger
                  value="interlock"
                  className="rounded-full px-4 py-2 text-sm md:px-6"
                >
                  Why It Works
                </TabsTrigger>
              </TabsList>
            </div>

            {/* macOS Window Container */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
              {/* Window Title Bar */}
              <div className="flex h-9 items-center gap-1.5 border-border border-b bg-muted/30 px-3">
                <div className="size-2.5 rounded-full bg-red-500/80" />
                <div className="size-2.5 rounded-full bg-yellow-500/80" />
                <div className="size-2.5 rounded-full bg-green-500/80" />
                <div className="ml-2 font-mono text-[11px] text-muted-foreground">
                  privacy-stack
                </div>
              </div>

              <div className="min-h-[450px] bg-background p-8 md:p-12">
                {/* Architecture Tab */}
                <TabsContent value="architecture" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-8">
                      <div>
                        <h3 className="mb-2 font-display font-bold text-2xl">
                          Core Service Stack
                        </h3>
                        <p className="landing-copy">
                          Web app plus dedicated OCR and FHE services.
                        </p>
                      </div>

                      <div className="space-y-6">
                        <div className="flex gap-4">
                          <IconDeviceDesktop
                            className={cn(
                              "size-6 shrink-0",
                              colorStyles.blue.iconText,
                            )}
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              Web Client (Next.js)
                            </h4>
                            <p className="landing-body mt-1">
                              Handles UI, multi-credential authentication,
                              encrypted vault management, and client-side ZK
                              proof generation tied to verified documents.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <IconServer
                            className={cn(
                              "size-6 shrink-0",
                              colorStyles.orange.iconText,
                            )}
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              FHE Service (Rust)
                            </h4>
                            <p className="landing-body mt-1">
                              Performs encrypted computations using TFHE-rs on
                              server-side ciphertext operations.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <IconCpu
                            className={cn(
                              "size-6 shrink-0",
                              colorStyles.yellow.iconText,
                            )}
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              OCR Service (Python)
                            </h4>
                            <p className="landing-body mt-1">
                              Transiently extracts document attributes, then
                              discards raw images.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Architecture Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-6">
                      {/* User + Credential Box */}
                      {/* biome-ignore lint/a11y/useSemanticElements: Diagram element, not a form fieldset */}
                      <div
                        role="group"
                        className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm"
                        aria-label="User authenticates with credential to unlock identity vault"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            User + Credential
                          </div>
                          <IconKey
                            className={cn("size-4", colorStyles.amber.iconText)}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Authenticates and unlocks vault
                        </div>
                      </div>

                      {/* User → Client Connection */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Client Box */}
                      {/* biome-ignore lint/a11y/useSemanticElements: Diagram element, not a form fieldset */}
                      <div
                        role="group"
                        className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm"
                        aria-label="Client browser generates ZK proofs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Client (Browser)
                          </div>
                          <IconDeviceDesktop
                            className={cn("size-4", colorStyles.blue.iconText)}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          ZK proof generation
                        </div>
                      </div>

                      {/* Client → Gateway Connection */}
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                        <div className="rounded-full border border-muted-foreground/30 bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          HTTPS / WSS
                        </div>
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Gateway Box */}
                      {/* biome-ignore lint/a11y/useSemanticElements: Diagram element, not a form fieldset */}
                      <div
                        role="group"
                        className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm"
                        aria-label="API Gateway routes to FHE and OCR services"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            API Gateway
                          </div>
                          <IconServer className="size-4 text-muted-foreground" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center justify-center gap-1.5 rounded border border-border bg-muted/30 p-2 font-medium text-foreground text-xs">
                            <IconServer
                              className={cn(
                                "size-3",
                                colorStyles.orange.iconText,
                              )}
                            />
                            FHE
                          </div>
                          <div className="flex items-center justify-center gap-1.5 rounded border border-border bg-muted/30 p-2 font-medium text-foreground text-xs">
                            <IconCpu
                              className={cn(
                                "size-3",
                                colorStyles.yellow.iconText,
                              )}
                            />
                            OCR
                          </div>
                        </div>
                      </div>

                      {/* Gateway → DB Connection */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* DB Box */}
                      {/* biome-ignore lint/a11y/useSemanticElements: Diagram element, not a form fieldset */}
                      <div
                        role="group"
                        className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm"
                        aria-label="Database stores encrypted secrets, proofs, commitments, and signed attestations"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Encrypted DB
                          </div>
                          <IconDatabase
                            className={cn(
                              "size-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Encrypted secrets + attestations
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Data Flow Tab */}
                <TabsContent value="dataflow" className="mt-0">
                  <div className="space-y-8">
                    <h3 className="mb-6 font-display font-bold text-2xl">
                      Privacy-Preserving Flow
                    </h3>

                    <div className="relative space-y-0">
                      {/* Connecting Line */}
                      <div className="absolute top-4 bottom-4 left-[15px] -z-10 w-0.5 bg-border" />

                      <div className="flex items-start gap-6">
                        <Badge
                          variant="outline"
                          className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground"
                        >
                          1
                        </Badge>
                        <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Data Extraction
                          </h4>
                          <p className="landing-body mb-2">
                            OCR extracts fields; images discarded; claim hashes
                            created.
                          </p>
                          <div className="rounded border border-border bg-muted px-3 py-2 font-mono text-foreground text-xs">
                            Input: "ID_Card.jpg" → Output: verified fields
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-6 pt-8">
                        <Badge
                          variant="outline"
                          className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground"
                        >
                          2
                        </Badge>
                        <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Proof Generation
                          </h4>
                          <p className="landing-body mb-2">
                            Client unlocks encrypted profile with your
                            credential, then proves eligibility with
                            zero-knowledge proofs.
                          </p>
                          <div className="rounded border border-border bg-muted px-3 py-2 font-mono text-foreground text-xs">
                            Generate(private inputs, nonce) → Proof_0x8f2…
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-6 pt-8">
                        <Badge
                          variant="outline"
                          className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-card p-0 text-sm text-foreground"
                        >
                          3
                        </Badge>
                        <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Verification
                          </h4>
                          <p className="landing-body mb-2">
                            Server verifies proofs and stores signed
                            attestations, commitments, and encrypted artifacts.
                            Identity disclosure requires user consent.
                          </p>
                          <div
                            className={cn(
                              "flex items-center gap-2 font-semibold text-xs",
                              colorStyles.emerald.text,
                            )}
                          >
                            <IconCircleCheck className="size-3" /> VERIFIED: Age
                            ≥ 18
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                      <div className="mb-3 flex items-center gap-2">
                        <IconLink
                          className={cn("size-4", colorStyles.blue.iconText)}
                        />
                        <h4 className="font-semibold text-foreground text-sm">
                          OAuth/OIDC scope progression
                        </h4>
                      </div>
                      <ol className="grid gap-2 text-sm md:grid-cols-2">
                        <li className="rounded-md border border-border bg-muted/30 p-3">
                          Sign in with proof scopes
                        </li>
                        <li className="rounded-md border border-border bg-muted/30 p-3">
                          User starts a higher-risk action
                        </li>
                        <li className="rounded-md border border-border bg-muted/30 p-3">
                          Request identity scopes when required
                        </li>
                        <li className="rounded-md border border-border bg-muted/30 p-3">
                          Return scoped response and continue
                        </li>
                      </ol>
                      <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                        Bank example: sign-in `openid email proof:verification`
                        {" -> "}identity request `identity.name`
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Key Custody Tab */}
                <TabsContent value="keycustody" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-2 font-display font-bold text-2xl">
                          Multi-Credential Key Custody
                        </h3>
                        <p className="landing-copy">
                          Three ways to authenticate with one custody model.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFingerprint
                              className={cn(
                                "size-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Passkey
                            </h4>
                          </div>
                          <p className="landing-body">
                            Face ID, Touch ID, or Windows Hello. No passwords to
                            remember—your biometric unlocks your encrypted
                            vault.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconKey
                              className={cn(
                                "size-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Password
                            </h4>
                          </div>
                          <p className="landing-body">
                            Strong password authentication where the server
                            never learns your password—only you can unlock your
                            data.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconLock
                              className={cn(
                                "size-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Crypto Wallet
                            </h4>
                          </div>
                          <p className="landing-body">
                            Use the Ethereum wallet you already have. One
                            signature unlocks your encrypted identity vault.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "size-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Same Security Model
                            </h4>
                          </div>
                          <p className="landing-body">
                            All three credentials follow the same custody flow,
                            with different UX and security tradeoffs. Profile
                            data is encrypted client-side, while disclosure
                            requires explicit user unlock.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Key Custody Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-6">
                      {/* Credential Options */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="mb-2 font-mono font-semibold text-foreground text-sm">
                          Your Credential
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/30 p-2">
                            <IconFingerprint
                              className={cn(
                                "size-4",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Passkey
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/30 p-2">
                            <IconKey
                              className={cn(
                                "size-4",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Password
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/30 p-2">
                            <IconLock
                              className={cn(
                                "size-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Wallet
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Arrow down */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Encryption Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Client-Side Encryption
                          </div>
                          <IconKey
                            className={cn(
                              "size-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Your credential encrypts your data locally
                        </div>
                      </div>

                      {/* Arrow down */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Server Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Server
                          </div>
                          <IconServer className="size-4 text-muted-foreground" />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Stores encrypted secrets + signed metadata
                        </div>
                        <div
                          className={cn(
                            "mt-2 flex items-center gap-2 text-xs",
                            colorStyles.red.iconText,
                          )}
                        >
                          <IconShieldCheck className="size-3" />
                          Cannot decrypt without your credential
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Credentials Tab */}
                <TabsContent value="credentials" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-2 font-display font-bold text-2xl">
                          Verifiable Credentials
                        </h3>
                        <p className="landing-copy">
                          Issue and present credentials via standard protocols.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "size-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              SD-JWT Credentials
                            </h4>
                          </div>
                          <p className="landing-body">
                            <code className="rounded bg-muted px-1 text-xs">
                              selective disclosure
                            </code>{" "}
                            format. Contains 12 claim types, including
                            cryptographically derived attributes.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconDatabase
                              className={cn(
                                "size-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4VCI Issuance
                            </h4>
                          </div>
                          <p className="landing-body">
                            Pre-authorized code flow for credential issuance.
                            Compatible with EUDI wallet architecture.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "size-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4VP Presentation
                            </h4>
                          </div>
                          <p className="landing-body">
                            Present credentials to external verifiers with
                            user-controlled selective disclosure.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconLink
                              className={cn(
                                "size-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4IDA Assurance
                            </h4>
                          </div>
                          <p className="landing-body">
                            <code className="rounded bg-muted px-1 text-xs">
                              verified_claims
                            </code>{" "}
                            structure with assurance metadata for identity
                            verification responses.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Credential Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-6">
                      {/* Zentity Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Zentity (Issuer)
                          </div>
                          <IconServer
                            className={cn(
                              "size-4",
                              colorStyles.purple.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Issues SD-JWT credentials
                        </div>
                      </div>

                      {/* OIDC4VCI Arrow */}
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                        <div className="rounded-full border border-muted-foreground/30 bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          OIDC4VCI
                        </div>
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* User Wallet Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            User Wallet
                          </div>
                          <IconKey
                            className={cn("size-4", colorStyles.amber.iconText)}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Stores credential, controls disclosure
                        </div>
                      </div>

                      {/* OIDC4VP Arrow */}
                      <div className="flex flex-col items-center">
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                        <div className="rounded-full border border-muted-foreground/30 bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          OIDC4VP
                        </div>
                        <div className="h-2 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Verifier Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Verifier (RP)
                          </div>
                          <IconShieldCheck
                            className={cn(
                              "size-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Receives only disclosed claims
                        </div>
                        <div
                          className={cn(
                            "mt-2 flex items-center gap-2 text-xs",
                            colorStyles.emerald.text,
                          )}
                        >
                          <IconCircleCheck className="size-3" />
                          Selective disclosure enforced
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* FHE Tab */}
                <TabsContent value="fhe" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-2 font-display font-bold text-2xl">
                          Fully Homomorphic Encryption
                        </h3>
                        <p className="landing-copy">
                          Compute on encrypted data—without decrypting.
                        </p>
                      </div>

                      <p className="landing-body">
                        The server runs compliance checks on your encrypted
                        values—age, liveness, and compliance thresholds—without
                        decrypting the underlying values.
                      </p>

                      <div className="space-y-4">
                        <h4 className="font-semibold text-foreground text-sm">
                          How It Works
                        </h4>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "size-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Age Checks
                              </span>
                            </div>
                            <p className="landing-caption mt-1">
                              Verify age thresholds on encrypted data
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "size-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Compliance Level Rules
                              </span>
                            </div>
                            <p className="landing-caption mt-1">
                              Evaluate policy thresholds without decrypting
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "size-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Compliance Gating
                              </span>
                            </div>
                            <p className="landing-caption mt-1">
                              Policy decisions on encrypted inputs
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-muted/30 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "size-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Anti-Spoofing
                              </span>
                            </div>
                            <p className="landing-caption mt-1">
                              Liveness verification stays encrypted
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* FHE Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-6">
                      {/* Browser Box - Encrypt */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Your Browser
                          </div>
                          <IconDeviceDesktop
                            className={cn("size-4", colorStyles.blue.iconText)}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Generates keys & encrypts data
                        </div>
                      </div>

                      {/* Connection */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* FHE Service */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            FHE Service
                          </div>
                          <IconServer
                            className={cn(
                              "size-4",
                              colorStyles.orange.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Computes without decrypting
                        </div>
                      </div>

                      {/* Connection */}
                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Browser Box - Decrypt */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Your Browser
                          </div>
                          <IconDeviceDesktop
                            className={cn(
                              "size-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Decrypts result with your key
                        </div>
                        <div
                          className={cn(
                            "mt-2 flex items-center gap-2 text-xs",
                            colorStyles.emerald.text,
                          )}
                        >
                          <IconCircleCheck className="size-3" />
                          Only you see the answer
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ZK Circuits Tab */}
                <TabsContent value="circuits" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-2 font-display font-bold text-2xl">
                          Zero-Knowledge Circuits
                        </h3>
                        <p className="landing-copy">
                          Client-side proofs that verify eligibility without
                          revealing private data.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "size-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Age Verification
                            </h4>
                          </div>
                          <p className="landing-body">
                            Prove you meet an age threshold without revealing
                            your date of birth.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "size-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Document Validity
                            </h4>
                          </div>
                          <p className="landing-body">
                            Prove your document is not expired without exposing
                            the expiry date.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "size-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Nationality & Residency
                            </h4>
                          </div>
                          <p className="landing-body">
                            Prove membership in a country group (EU, Schengen)
                            without revealing which country.
                          </p>
                        </div>

                        <div className="rounded-lg border border-border bg-muted/30 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "size-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Liveness & Face Match
                            </h4>
                          </div>
                          <p className="landing-body">
                            Prove face similarity exceeds a threshold without
                            storing biometric templates.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ZK Visual */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/30 p-6">
                      {/* Private Inputs */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Private Inputs (Browser)
                          </div>
                          <IconLock
                            className={cn(
                              "size-4",
                              colorStyles.purple.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Private inputs stay in-browser during proof generation
                        </div>
                      </div>

                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Proof Generation */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            ZK Proof Generation
                          </div>
                          <IconShieldCheck
                            className={cn("size-4", colorStyles.blue.iconText)}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Generates cryptographic proof client-side
                        </div>
                      </div>

                      <div className="flex justify-center">
                        <div className="h-3 w-px border-muted-foreground/40 border-l border-dashed" />
                      </div>

                      {/* Verification */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Server Verification
                          </div>
                          <IconCircleCheck
                            className={cn(
                              "size-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Verifies proof without seeing private data
                        </div>
                        <div
                          className={cn(
                            "mt-2 flex items-center gap-2 text-xs",
                            colorStyles.emerald.text,
                          )}
                        >
                          <IconCircleCheck className="size-3" />
                          Result: eligible / not eligible
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Why It Works Tab */}
                <TabsContent value="interlock" className="mt-0">
                  <div className="space-y-8">
                    <div>
                      <h3 className="mb-2 font-display font-bold text-2xl">
                        Why This Architecture Works
                      </h3>
                      <p className="landing-copy">
                        Privacy emerges from how components depend on each
                        other—not from any single technology.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-muted/30 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <IconKey
                            className={cn("size-5", colorStyles.amber.iconText)}
                          />
                          <h4 className="font-semibold text-foreground">
                            User-Held Keys
                          </h4>
                        </div>
                        <p className="landing-body">
                          Credential-derived keys stay user-controlled.
                          Encrypted profile blobs remain unreadable without user
                          unlock.
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/30 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <IconServer
                            className={cn(
                              "size-5",
                              colorStyles.orange.iconText,
                            )}
                          />
                          <h4 className="font-semibold text-foreground">
                            Server Integrity
                          </h4>
                        </div>
                        <p className="landing-body">
                          The server attests to document and liveness
                          measurements, ensuring clients cannot forge
                          verification results.
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/30 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <IconShieldCheck
                            className={cn(
                              "size-5",
                              colorStyles.purple.iconText,
                            )}
                          />
                          <h4 className="font-semibold text-foreground">
                            Zero-Knowledge Proofs
                          </h4>
                        </div>
                        <p className="landing-body">
                          Prove eligibility without revealing underlying
                          attributes. The verifier learns only yes or no.
                        </p>
                      </div>

                      <div className="rounded-lg border border-border bg-muted/30 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <IconFileCode
                            className={cn(
                              "size-5",
                              colorStyles.emerald.iconText,
                            )}
                          />
                          <h4 className="font-semibold text-foreground">
                            Scoped Claims by Default
                          </h4>
                        </div>
                        <p className="landing-body">
                          `proof:*` scopes return derived verification results
                          by default. `identity.*` claims require explicit user
                          consent and vault unlock.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-muted/30 p-6">
                      <div className="flex items-center gap-3">
                        <IconLink
                          className={cn(
                            "size-5 shrink-0",
                            colorStyles.emerald.iconText,
                          )}
                        />
                        <p className="font-medium text-foreground">
                          Math, not walls
                        </p>
                      </div>
                      <p className="landing-body mt-2">
                        Critical privacy boundaries are enforced by cryptography
                        and scope-based consent controls.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
