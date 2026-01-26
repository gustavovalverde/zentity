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
  IconX,
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
                              Handles UI, multi-credential authentication
                              (passkey/OPAQUE/wallet), vault unlock with
                              credential-derived keys, and ZK proof generation
                              (Noir/WASM) tied to verified docs.
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
                          Passkey/OPAQUE/Wallet → KEK
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
                            Client unlocks profile with credential-derived keys
                            (passkey, password, or wallet), then proves
                            eligibility with ZK.
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
                              Passkey (WebAuthn PRF)
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Face ID, Touch ID, or Windows Hello. PRF output →
                            HKDF → KEK. No passwords to remember.
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
                              Password (OPAQUE RFC 9807)
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Server-augmented PAKE. Export key → HKDF → KEK.
                            Server never learns the password.
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
                              Wallet (EIP-712/SIWE)
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Sign structured message → HKDF → KEK. Same Ethereum
                            wallet you already use.
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
                            All three derive the same KEK. Your FHE keys and
                            profile are wrapped—only your credential unwraps
                            them locally.
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
                              OPAQUE
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

                      {/* HKDF Box */}
                      <div className="z-10 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            HKDF → KEK
                          </div>
                          <IconKey
                            className={cn(
                              "h-4 w-4",
                              colorStyles.emerald.iconText,
                            )}
                          />
                        </div>
                        <div className="mt-1 text-muted-foreground/70 text-xs">
                          Same key encryption key, any credential
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
                          Stores encrypted blobs only
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
                          What Gets Encrypted
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
                                Birth Year Offset
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              For age threshold checks
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
                                Country Code
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              For nationality allowlists
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
                                Compliance Level
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              For policy gating
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
                                Liveness Score
                              </span>
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              For anti-spoofing
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
                    <div>
                      <h3 className="mb-6 font-bold text-2xl">Noir Circuits</h3>
                      <ul className="grid grid-cols-2 gap-3">
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              age_verification.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Prove age ≥ threshold without DOB.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              doc_validity.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Prove document not expired.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              face_match.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Prove face similarity ≥ threshold.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.purple.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              nationality_membership.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Prove nationality in group (EU, SCHENGEN).
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.blue.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              address_jurisdiction.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Prove address in jurisdiction via Merkle.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <IconFileCode
                              className={cn(
                                "h-4 w-4",
                                colorStyles.emerald.iconText,
                              )}
                            />
                            <h4 className="font-semibold text-foreground text-sm">
                              identity_binding.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            Auth-agnostic replay prevention.
                          </p>
                        </li>
                      </ul>
                    </div>

                    {/* Code Preview */}
                    <div className="group relative">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-purple-500/20 to-blue-500/20 opacity-50 blur-lg transition-opacity group-hover:opacity-100" />
                      <div className="relative min-h-[300px] overflow-hidden rounded-xl border border-border/50 bg-[#0d1117] p-4 font-mono text-gray-300 text-sm shadow-xl">
                        <div className="mb-4 flex items-center justify-between border-gray-800 border-b pb-2 text-gray-500 text-xs">
                          <span>age_verification/src/main.nr</span>
                          <span>Noir</span>
                        </div>
                        <pre className="overflow-x-auto text-xs">
                          {`use noir_poseidon2::poseidon2;

fn main(
  dob_days: Field,          // Days since epoch
  document_hash: Field,     // Server-signed hash
  current_days: pub Field,  // Public reference date
  min_age_days: pub Field,  // Age threshold in days
  nonce: pub Field,         // Replay prevention
  claim_hash: pub Field     // Binding commitment
) -> pub bool {
  // Verify claim binding
  let computed = poseidon2([dob_days, document_hash]);
  assert(computed == claim_hash);

  // Age check without revealing DOB
  let age_days = current_days - dob_days;
  age_days >= min_age_days
}`}
                        </pre>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Why It Works Tab */}
                <TabsContent value="interlock" className="mt-0">
                  <div className="space-y-8">
                    <div>
                      <h3 className="mb-2 font-bold text-2xl">
                        The Interlock: Why Each Piece is Necessary
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
                            Credential-Derived Keys
                          </h4>
                        </div>
                        <div className="flex items-start gap-2">
                          <IconX
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              colorStyles.red.iconText,
                            )}
                          />
                          <p className="text-muted-foreground text-sm">
                            Without passkey/password-derived keys, the server
                            holds decryption capability—making it a honeypot.
                          </p>
                        </div>
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
                            Server-Signed Measurements
                          </h4>
                        </div>
                        <div className="flex items-start gap-2">
                          <IconX
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              colorStyles.red.iconText,
                            )}
                          />
                          <p className="text-muted-foreground text-sm">
                            Without server attestations on OCR/liveness, clients
                            could forge their own measurements.
                          </p>
                        </div>
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
                        <div className="flex items-start gap-2">
                          <IconX
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              colorStyles.red.iconText,
                            )}
                          />
                          <p className="text-muted-foreground text-sm">
                            Without ZK proofs, proving eligibility requires
                            revealing actual attributes—birth date, nationality.
                          </p>
                        </div>
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
                            Proof-Based Credentials
                          </h4>
                        </div>
                        <div className="flex items-start gap-2">
                          <IconX
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              colorStyles.red.iconText,
                            )}
                          />
                          <p className="text-muted-foreground text-sm">
                            Without derived claims, credentials embed raw
                            PII—selective disclosure still leaks data.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border bg-card/50 p-5">
                        <div className="mb-3 flex items-center gap-3">
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg",
                              colorStyles.blue.bg,
                              colorStyles.blue.border,
                              "border",
                            )}
                          >
                            <IconLink
                              className={cn(
                                "h-4 w-4",
                                colorStyles.blue.iconText,
                              )}
                            />
                          </div>
                          <h4 className="font-semibold text-foreground">
                            Identity Binding
                          </h4>
                        </div>
                        <div className="flex items-start gap-2">
                          <IconX
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              colorStyles.red.iconText,
                            )}
                          />
                          <p className="text-muted-foreground text-sm">
                            Without identity binding, proofs could be replayed
                            across users—any credential type, same protection.
                          </p>
                        </div>
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
                          The chain is complete: Math, not walls.
                        </p>
                      </div>
                      <p className="mt-2 text-muted-foreground text-sm">
                        Remove any component and the guarantees collapse. The
                        server doesn't have the keys—not because of policy, but
                        because of cryptography.
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
