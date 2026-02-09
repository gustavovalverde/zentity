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

import { ColoredIconBox } from "@/components/ui/colored-icon-box";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { colorStyles } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function TechnicalDeepDive() {
  return (
    <section
      className="border-border/50 border-y bg-muted/30 py-24"
      id="architecture"
    >
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="mb-16 text-center">
          <h2 className="mb-4 font-bold text-3xl md:text-4xl">
            Technical Deep-Dive
          </h2>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Under the hood of the privacy machine.
          </p>
        </div>

        <div className="mx-auto max-w-6xl">
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
              <div className="flex h-10 items-center gap-2 border-border border-b bg-muted/30 px-4">
                <div className="h-3 w-3 rounded-full bg-red-500/80" />
                <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
                <div className="h-3 w-3 rounded-full bg-green-500/80" />
                <div className="ml-4 font-mono text-muted-foreground text-xs">
                  privacy-stack
                </div>
              </div>

              <div className="min-h-[450px] bg-background p-8 md:p-12">
                {/* Architecture Tab */}
                <TabsContent value="architecture" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-8">
                      <div>
                        <h3 className="mb-2 font-bold text-2xl">
                          Core Service Stack
                        </h3>
                        <p className="text-muted-foreground">
                          Web app plus dedicated OCR and FHE services.
                        </p>
                      </div>

                      <div className="space-y-6">
                        <div className="flex gap-4">
                          <ColoredIconBox
                            icon={IconDeviceDesktop}
                            color="blue"
                            size="lg"
                            className="h-fit"
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              Web Client (Next.js)
                            </h4>
                            <p className="mt-1 text-muted-foreground text-sm">
                              Handles UI, multi-credential authentication,
                              encrypted vault management, and client-side ZK
                              proof generation tied to verified documents.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <ColoredIconBox
                            icon={IconServer}
                            color="orange"
                            size="lg"
                            className="h-fit"
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              FHE Service (Rust)
                            </h4>
                            <p className="mt-1 text-muted-foreground text-sm">
                              Performs encrypted computations using TFHE-rs.
                              Never sees plaintext.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <ColoredIconBox
                            icon={IconCpu}
                            color="yellow"
                            size="lg"
                            className="h-fit"
                          />
                          <div>
                            <h4 className="font-semibold text-foreground">
                              OCR Service (Python)
                            </h4>
                            <p className="mt-1 text-muted-foreground text-sm">
                              Transiently extracts document attributes, then
                              discards raw images.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Architecture Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-6">
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
                            className={cn(
                              "h-4 w-4",
                              colorStyles.amber.iconText,
                            )}
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
                            className={cn("h-4 w-4", colorStyles.blue.iconText)}
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
                          <IconServer className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center justify-center gap-1.5 rounded border border-border bg-muted/50 p-2 font-medium text-foreground text-xs">
                            <IconServer
                              className={cn(
                                "h-3 w-3",
                                colorStyles.orange.iconText,
                              )}
                            />
                            FHE
                          </div>
                          <div className="flex items-center justify-center gap-1.5 rounded border border-border bg-muted/50 p-2 font-medium text-foreground text-xs">
                            <IconCpu
                              className={cn(
                                "h-3 w-3",
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
                        aria-label="Database stores only proofs and sealed data"
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Encrypted DB
                          </div>
                          <IconDatabase
                            className={cn(
                              "h-4 w-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Proofs + sealed data
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Data Flow Tab */}
                <TabsContent value="dataflow" className="mt-0">
                  <div className="space-y-8">
                    <h3 className="mb-6 font-bold text-2xl">
                      Privacy-Preserving Flow
                    </h3>

                    <div className="relative space-y-0">
                      {/* Connecting Line */}
                      <div className="absolute top-8 bottom-8 left-[27px] -z-10 w-0.5 bg-border" />

                      <div className="flex items-start gap-6">
                        <div
                          className={cn(
                            "z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold shadow-sm",
                            colorStyles.red.iconText,
                          )}
                        >
                          1
                        </div>
                        <div className="flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Data Extraction
                          </h4>
                          <p className="mb-2 text-muted-foreground text-sm">
                            OCR extracts fields; images discarded; claim hashes
                            created.
                          </p>
                          <div className="rounded border border-border bg-muted px-3 py-2 font-mono text-foreground text-xs">
                            Input: "ID_Card.jpg" → Output: verified fields
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-6 pt-8">
                        <div
                          className={cn(
                            "z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold shadow-sm",
                            colorStyles.purple.iconText,
                          )}
                        >
                          2
                        </div>
                        <div className="flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Proof Generation
                          </h4>
                          <p className="mb-2 text-muted-foreground text-sm">
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
                        <div
                          className={cn(
                            "z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold shadow-sm",
                            colorStyles.emerald.iconText,
                          )}
                        >
                          3
                        </div>
                        <div className="flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Verification
                          </h4>
                          <p className="mb-2 text-muted-foreground text-sm">
                            Server verifies proofs and stores encrypted
                            artifacts. Disclosure requires user consent.
                          </p>
                          <div
                            className={cn(
                              "flex items-center gap-2 font-semibold text-xs",
                              colorStyles.emerald.text,
                            )}
                          >
                            <IconCircleCheck className="h-3 w-3" /> VERIFIED:
                            Age ≥ 18
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Key Custody Tab */}
                <TabsContent value="keycustody" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-6">
                      <div>
                        <h3 className="mb-2 font-bold text-2xl">
                          Multi-Credential Key Custody
                        </h3>
                        <p className="text-muted-foreground">
                          Three ways to authenticate—same security guarantee.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFingerprint
                              className={cn(
                                "h-5 w-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Passkey
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Face ID, Touch ID, or Windows Hello. No passwords to
                            remember—your biometric unlocks your encrypted
                            vault.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconKey
                              className={cn(
                                "h-5 w-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Password
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Strong password authentication where the server
                            never learns your password—only you can unlock your
                            data.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconLock
                              className={cn(
                                "h-5 w-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Crypto Wallet
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Use the Ethereum wallet you already have. One
                            signature unlocks your encrypted identity vault.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "h-5 w-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Same Security Model
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            All three credentials provide the same level of
                            protection. Your data is encrypted locally—the
                            server stores only opaque blobs it cannot read.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Key Custody Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-6">
                      {/* Credential Options */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="mb-2 font-mono font-semibold text-foreground text-sm">
                          Your Credential
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/50 p-2">
                            <IconFingerprint
                              className={cn(
                                "h-4 w-4",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Passkey
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/50 p-2">
                            <IconKey
                              className={cn(
                                "h-4 w-4",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              Password
                            </span>
                          </div>
                          <div className="flex flex-col items-center gap-1 rounded border border-border bg-muted/50 p-2">
                            <IconLock
                              className={cn(
                                "h-4 w-4",
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
                              "h-4 w-4",
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
                          <IconServer className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Stores encrypted data only
                        </div>
                        <div
                          className={cn(
                            "mt-2 flex items-center gap-2 text-xs",
                            colorStyles.red.iconText,
                          )}
                        >
                          <IconShieldCheck className="h-3 w-3" />
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
                        <h3 className="mb-2 font-bold text-2xl">
                          Verifiable Credentials
                        </h3>
                        <p className="text-muted-foreground">
                          Issue and present credentials via OIDC4VCI/VP
                          standards.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "h-5 w-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              SD-JWT Credentials
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            <code className="rounded bg-muted px-1 text-xs">
                              dc+sd-jwt
                            </code>{" "}
                            format with selective disclosure. 12 claim types
                            including ZK-derived attributes.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconDatabase
                              className={cn(
                                "h-5 w-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4VCI Issuance
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Pre-authorized code flow for credential issuance.
                            Compatible with EUDI wallet architecture.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "h-5 w-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4VP Presentation
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Present credentials to external verifiers with
                            user-controlled selective disclosure.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconLink
                              className={cn(
                                "h-5 w-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              OIDC4IDA Assurance
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            <code className="rounded bg-muted px-1 text-xs">
                              verified_claims
                            </code>{" "}
                            structure with assurance levels matching eIDAS trust
                            frameworks.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Credential Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-6">
                      {/* Zentity Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Zentity (Issuer)
                          </div>
                          <IconServer
                            className={cn(
                              "h-4 w-4",
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
                            className={cn(
                              "h-4 w-4",
                              colorStyles.amber.iconText,
                            )}
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
                              "h-4 w-4",
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
                          <IconCircleCheck className="h-3 w-3" />
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
                        <h3 className="mb-2 font-bold text-2xl">
                          Fully Homomorphic Encryption
                        </h3>
                        <p className="text-muted-foreground">
                          Compute on encrypted data—without decrypting.
                        </p>
                      </div>

                      <p className="text-muted-foreground text-sm">
                        The server runs compliance checks on your encrypted
                        values—age thresholds, nationality allowlists—without
                        ever decrypting them. Only you see the actual data.
                      </p>

                      <div className="space-y-4">
                        <h4 className="font-semibold text-foreground text-sm">
                          How It Works
                        </h4>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-card/50 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "h-3.5 w-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Age Checks
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              Verify age thresholds on encrypted data
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-card/50 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "h-3.5 w-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Nationality Rules
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              Evaluate allowlists without decrypting
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-card/50 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "h-3.5 w-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Compliance Gating
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              Policy decisions on encrypted inputs
                            </div>
                          </div>
                          <div className="rounded-lg border border-border bg-card/50 p-3">
                            <div className="flex items-center gap-2">
                              <IconLock
                                className={cn(
                                  "h-3.5 w-3.5",
                                  colorStyles.blue.iconText,
                                )}
                              />
                              <span className="font-medium text-foreground text-sm">
                                Anti-Spoofing
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              Liveness verification stays encrypted
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* FHE Flow Diagram */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-6">
                      {/* Browser Box - Encrypt */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Your Browser
                          </div>
                          <IconDeviceDesktop
                            className={cn("h-4 w-4", colorStyles.blue.iconText)}
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
                              "h-4 w-4",
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
                              "h-4 w-4",
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
                          <IconCircleCheck className="h-3 w-3" />
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
                        <h3 className="mb-2 font-bold text-2xl">
                          Zero-Knowledge Circuits
                        </h3>
                        <p className="text-muted-foreground">
                          Client-side proofs that verify eligibility without
                          revealing private data.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconShieldCheck
                              className={cn(
                                "h-5 w-5",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Age Verification
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Prove you meet an age threshold without revealing
                            your date of birth.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "h-5 w-5",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Document Validity
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Prove your document is not expired without exposing
                            the expiry date.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "h-5 w-5",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Nationality & Residency
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Prove membership in a country group (EU, Schengen)
                            without revealing which country.
                          </p>
                        </div>

                        <div className="rounded-xl border border-border bg-card/50 p-4">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode
                              className={cn(
                                "h-5 w-5",
                                colorStyles.amber.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground">
                              Liveness & Face Match
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Prove face similarity exceeds a threshold without
                            storing biometric templates.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ZK Visual */}
                    <div className="relative flex flex-col gap-1 rounded-xl border border-border bg-muted/20 p-6">
                      {/* Private Inputs */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            Private Inputs (Browser)
                          </div>
                          <IconLock
                            className={cn(
                              "h-4 w-4",
                              colorStyles.purple.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Your data never leaves your device
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
                            className={cn("h-4 w-4", colorStyles.blue.iconText)}
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
                              "h-4 w-4",
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
                          <IconCircleCheck className="h-3 w-3" />
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
                      <h3 className="mb-2 font-bold text-2xl">
                        Why This Architecture Works
                      </h3>
                      <p className="text-muted-foreground">
                        Privacy emerges from how components depend on each
                        other—not from any single technology.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-xl border border-border bg-card/50 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg",
                              colorStyles.amber.bg,
                              colorStyles.amber.border,
                              "border",
                            )}
                          >
                            <IconKey
                              className={cn(
                                "h-4 w-4",
                                colorStyles.amber.iconText,
                              )}
                            />
                          </div>
                          <h4 className="font-semibold text-foreground">
                            User-Held Keys
                          </h4>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Encryption keys never leave your device. A database
                          breach exposes only opaque blobs that cannot be
                          decrypted.
                        </p>
                      </div>

                      <div className="rounded-xl border border-border bg-card/50 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg",
                              colorStyles.orange.bg,
                              colorStyles.orange.border,
                              "border",
                            )}
                          >
                            <IconServer
                              className={cn(
                                "h-4 w-4",
                                colorStyles.orange.iconText,
                              )}
                            />
                          </div>
                          <h4 className="font-semibold text-foreground">
                            Server Integrity
                          </h4>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          The server attests to document and liveness
                          measurements, ensuring clients cannot forge
                          verification results.
                        </p>
                      </div>

                      <div className="rounded-xl border border-border bg-card/50 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg",
                              colorStyles.purple.bg,
                              colorStyles.purple.border,
                              "border",
                            )}
                          >
                            <IconShieldCheck
                              className={cn(
                                "h-4 w-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                          </div>
                          <h4 className="font-semibold text-foreground">
                            Zero-Knowledge Proofs
                          </h4>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Prove eligibility without revealing underlying
                          attributes. The verifier learns only yes or no.
                        </p>
                      </div>

                      <div className="rounded-xl border border-border bg-card/50 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg",
                              colorStyles.emerald.bg,
                              colorStyles.emerald.border,
                              "border",
                            )}
                          >
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.emerald.iconText,
                              )}
                            />
                          </div>
                          <h4 className="font-semibold text-foreground">
                            Derived Claims Only
                          </h4>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          Credentials contain verification results—never raw
                          PII. Even with selective disclosure, nothing sensitive
                          leaks.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                      <div className="flex items-center gap-3">
                        <IconLink
                          className={cn(
                            "h-5 w-5 shrink-0",
                            colorStyles.emerald.iconText,
                          )}
                        />
                        <p className="font-medium text-foreground">
                          Math, not walls.
                        </p>
                      </div>
                      <p className="mt-2 text-muted-foreground text-sm">
                        The server can't read your data—not because of policy,
                        but because of cryptography. Every privacy guarantee is
                        mathematically enforced.
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
