import {
  IconCircleCheck,
  IconCpu,
  IconDeviceDesktop,
  IconFileCode,
  IconServer,
} from "@tabler/icons-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          <Tabs defaultValue="architecture" className="w-full">
            {/* Pill-shaped Tabs */}
            <div className="mb-12 flex justify-center">
              <TabsList className="h-auto w-fit rounded-full border border-border bg-muted p-1">
                <TabsTrigger
                  value="architecture"
                  className="rounded-full px-6 py-2"
                >
                  Architecture
                </TabsTrigger>
                <TabsTrigger
                  value="dataflow"
                  className="rounded-full px-6 py-2"
                >
                  Data Flow
                </TabsTrigger>
                <TabsTrigger
                  value="circuits"
                  className="rounded-full px-6 py-2"
                >
                  ZK Circuits
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
                  zentity-architecture.v1
                </div>
              </div>

              <div className="min-h-[450px] bg-background p-8 md:p-12">
                {/* Architecture Tab */}
                <TabsContent value="architecture" className="mt-0">
                  <div className="grid items-center gap-12 md:grid-cols-2">
                    <div className="space-y-8">
                      <div>
                        <h3 className="mb-2 font-bold text-2xl">
                          3-Service Monorepo
                        </h3>
                        <p className="text-muted-foreground">
                          Detailed breakdown of the system components.
                        </p>
                      </div>

                      <div className="space-y-6">
                        <div className="flex gap-4">
                          <div className="h-fit rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-blue-400">
                            <IconDeviceDesktop className="h-6 w-6" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground">
                              Web Client (Next.js)
                            </h4>
                            <p className="mt-1 text-muted-foreground text-sm">
                              Handles UI, passkey-sealed profile unlock, and ZK
                              proof generation (Noir/WASM) tied to verified
                              docs.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="h-fit rounded-xl border border-orange-500/20 bg-orange-500/10 p-3 text-orange-400">
                            <IconServer className="h-6 w-6" />
                          </div>
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
                          <div className="h-fit rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-yellow-400">
                            <IconCpu className="h-6 w-6" />
                          </div>
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
                    <div className="relative flex h-full min-h-[300px] flex-col justify-between rounded-xl border border-border bg-muted/20 p-6">
                      {/* Client Box */}
                      <div className="z-10 flex items-center justify-between rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="font-mono font-semibold text-foreground text-sm">
                          Client
                        </div>
                        <IconDeviceDesktop className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Connection Line */}
                      <div className="relative my-4 flex flex-1 flex-col items-center justify-center">
                        <div className="absolute inset-y-0 left-1/2 -ml-[0.5px] w-px border-border border-l border-dashed" />
                        <div className="z-10 rounded-full border border-border bg-background px-3 py-1 font-mono text-[10px] text-muted-foreground">
                          HTTPS / WSS
                        </div>
                      </div>

                      {/* Gateway Box */}
                      <div className="z-10 mb-4 rounded-lg border border-border bg-background p-4 shadow-sm">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="font-mono font-semibold text-foreground text-sm">
                            API Gateway
                          </div>
                          <IconServer className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div className="rounded border border-orange-500/20 bg-orange-500/10 p-2 text-center font-medium text-orange-400 text-xs">
                            FHE Service
                          </div>
                          <div className="rounded border border-yellow-500/20 bg-yellow-500/10 p-2 text-center font-medium text-xs text-yellow-400">
                            OCR Service
                          </div>
                        </div>
                      </div>

                      {/* DB Box */}
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-center font-mono text-blue-400 text-xs">
                        Encrypted DB (Proofs + Sealed Data)
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
                        <div className="z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold text-red-500 shadow-sm">
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
                        <div className="z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold text-purple-400 shadow-sm">
                          2
                        </div>
                        <div className="flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
                          <h4 className="mb-1 font-semibold text-foreground">
                            Proof Generation
                          </h4>
                          <p className="mb-2 text-muted-foreground text-sm">
                            Client unlocks profile with passkey, then proves
                            eligibility with ZK.
                          </p>
                          <div className="rounded border border-border bg-muted px-3 py-2 font-mono text-foreground text-xs">
                            Generate(private inputs, nonce) → Proof_0x8f2...
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-6 pt-8">
                        <div className="z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-background font-bold text-emerald-400 shadow-sm">
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
                          <div className="flex items-center gap-2 font-semibold text-emerald-400 text-xs">
                            <IconCircleCheck className="h-3 w-3" /> VERIFIED:
                            Age ≥ 18
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* ZK Circuits Tab */}
                <TabsContent value="circuits" className="mt-0">
                  <div className="grid gap-12 md:grid-cols-2">
                    <div>
                      <h3 className="mb-6 font-bold text-2xl">Noir Circuits</h3>
                      <ul className="space-y-4">
                        <li className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              age_verification.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Proves age is above threshold without revealing
                            birth date.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              doc_validity.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Proves document expiration is valid.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              face_match.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Proves face match meets a threshold without storing
                            biometrics.
                          </p>
                        </li>
                        <li className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-card">
                          <div className="mb-2 flex items-center gap-3">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              nationality_membership.nr
                            </h4>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            Proves nationality belongs to a group (EU, SCHENGEN)
                            via Merkle proof.
                          </p>
                        </li>
                      </ul>
                    </div>

                    {/* Code Preview */}
                    <div className="group relative">
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-purple-500/20 to-blue-500/20 opacity-50 blur-lg transition-opacity group-hover:opacity-100" />
                      <div className="relative min-h-[300px] overflow-hidden rounded-xl border border-border/50 bg-[#0d1117] p-4 font-mono text-gray-300 text-sm shadow-xl">
                        <div className="mb-4 flex items-center justify-between border-gray-800 border-b pb-2 text-gray-500 text-xs">
                          <span>main.nr</span>
                          <span>Noir</span>
                        </div>
                        <pre className="overflow-x-auto text-xs">
                          {`use nodash::poseidon2;

fn main(
  birth_year: Field,
  document_hash: Field,
  current_year: pub Field,
  min_age: pub Field,
  nonce: pub Field,
  claim_hash: pub Field
) -> pub bool {
  let _ = nonce;
  let computed = poseidon2([birth_year, document_hash]);
  assert(computed == claim_hash);
  let age = current_year as u32 - birth_year as u32;
  age >= min_age as u32
}`}
                        </pre>
                      </div>
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
