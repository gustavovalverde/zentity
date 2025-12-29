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
      className="py-24 bg-muted/30 border-y border-border/50"
      id="architecture"
    >
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Technical Deep-Dive
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Under the hood of the privacy machine.
          </p>
        </div>

        <div className="max-w-6xl mx-auto">
          <Tabs defaultValue="architecture" className="w-full">
            {/* Pill-shaped Tabs */}
            <div className="flex justify-center mb-12">
              <TabsList className="bg-muted p-1 border border-border h-auto rounded-full w-fit">
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
            <div className="relative rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
              {/* Window Title Bar */}
              <div className="h-10 border-b border-border bg-muted/30 flex items-center px-4 gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                <div className="ml-4 text-xs font-mono text-muted-foreground">
                  zentity-architecture.v1
                </div>
              </div>

              <div className="p-8 md:p-12 min-h-[450px] bg-background">
                {/* Architecture Tab */}
                <TabsContent value="architecture" className="mt-0">
                  <div className="grid md:grid-cols-2 gap-12 items-center">
                    <div className="space-y-8">
                      <div>
                        <h3 className="text-2xl font-bold mb-2">
                          3-Service Monorepo
                        </h3>
                        <p className="text-muted-foreground">
                          Detailed breakdown of the system components.
                        </p>
                      </div>

                      <div className="space-y-6">
                        <div className="flex gap-4">
                          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 h-fit border border-blue-500/20">
                            <IconDeviceDesktop className="h-6 w-6" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground">
                              Web Client (Next.js)
                            </h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              Handles UI, client key storage, and ZK proof
                              generation (Noir/WASM) tied to verified docs.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="p-3 bg-orange-500/10 rounded-xl text-orange-400 h-fit border border-orange-500/20">
                            <IconServer className="h-6 w-6" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground">
                              FHE Service (Rust)
                            </h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              Performs encrypted computations using TFHE-rs.
                              Never sees plaintext.
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="p-3 bg-yellow-500/10 rounded-xl text-yellow-400 h-fit border border-yellow-500/20">
                            <IconCpu className="h-6 w-6" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground">
                              OCR Service (Python)
                            </h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              Transiently extracts document attributes, then
                              discards raw images.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Architecture Diagram */}
                    <div className="rounded-xl border border-border bg-muted/20 p-6 flex flex-col justify-between h-full min-h-[300px] relative">
                      {/* Client Box */}
                      <div className="p-4 rounded-lg bg-background border border-border shadow-sm flex items-center justify-between z-10">
                        <div className="font-mono text-sm font-semibold text-foreground">
                          Client
                        </div>
                        <IconDeviceDesktop className="h-4 w-4 text-muted-foreground" />
                      </div>

                      {/* Connection Line */}
                      <div className="flex-1 flex flex-col items-center justify-center my-4 relative">
                        <div className="absolute inset-y-0 w-px border-l border-dashed border-border left-1/2 -ml-[0.5px]" />
                        <div className="bg-background px-3 py-1 text-[10px] font-mono border border-border rounded-full text-muted-foreground z-10">
                          HTTPS / WSS
                        </div>
                      </div>

                      {/* Gateway Box */}
                      <div className="p-4 rounded-lg bg-background border border-border shadow-sm z-10 mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-mono text-sm font-semibold text-foreground">
                            API Gateway
                          </div>
                          <IconServer className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-2">
                          <div className="p-2 rounded bg-orange-500/10 border border-orange-500/20 text-xs font-medium text-orange-400 text-center">
                            FHE Service
                          </div>
                          <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs font-medium text-yellow-400 text-center">
                            OCR Service
                          </div>
                        </div>
                      </div>

                      {/* DB Box */}
                      <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-center text-xs text-blue-400 font-mono">
                        Encrypted DB (Data + Proofs)
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Data Flow Tab */}
                <TabsContent value="dataflow" className="mt-0">
                  <div className="space-y-8">
                    <h3 className="text-2xl font-bold mb-6">
                      Privacy-Preserving Flow
                    </h3>

                    <div className="space-y-0 relative">
                      {/* Connecting Line */}
                      <div className="absolute top-8 bottom-8 left-[27px] w-0.5 bg-border -z-10" />

                      <div className="flex gap-6 items-start">
                        <div className="shrink-0 w-14 h-14 rounded-full bg-background border border-border flex items-center justify-center text-red-500 font-bold shadow-sm z-10">
                          1
                        </div>
                        <div className="bg-card border border-border p-4 rounded-xl flex-1 shadow-sm">
                          <h4 className="font-semibold text-foreground mb-1">
                            Data Extraction
                          </h4>
                          <p className="text-sm text-muted-foreground mb-2">
                            OCR extracts fields (no storage).
                          </p>
                          <div className="bg-muted px-3 py-2 rounded text-xs font-mono text-foreground border border-border">
                            Input: "ID_Card.jpg" → Output: verified fields
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-6 items-start pt-8">
                        <div className="shrink-0 w-14 h-14 rounded-full bg-background border border-border flex items-center justify-center text-purple-400 font-bold shadow-sm z-10">
                          2
                        </div>
                        <div className="bg-card border border-border p-4 rounded-xl flex-1 shadow-sm">
                          <h4 className="font-semibold text-foreground mb-1">
                            Proof Generation
                          </h4>
                          <p className="text-sm text-muted-foreground mb-2">
                            Client proves eligibility with ZK.
                          </p>
                          <div className="bg-muted px-3 py-2 rounded text-xs font-mono text-foreground border border-border">
                            Generate(private inputs, nonce) → Proof_0x8f2...
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-6 items-start pt-8">
                        <div className="shrink-0 w-14 h-14 rounded-full bg-background border border-border flex items-center justify-center text-emerald-400 font-bold shadow-sm z-10">
                          3
                        </div>
                        <div className="bg-card border border-border p-4 rounded-xl flex-1 shadow-sm">
                          <h4 className="font-semibold text-foreground mb-1">
                            Verification
                          </h4>
                          <p className="text-sm text-muted-foreground mb-2">
                            Server verifies the mathematical proof.
                          </p>
                          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
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
                  <div className="grid md:grid-cols-2 gap-12">
                    <div>
                      <h3 className="text-2xl font-bold mb-6">Noir Circuits</h3>
                      <ul className="space-y-4">
                        <li className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              age_verification.nr
                            </h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Proves age is above threshold without revealing
                            birth date.
                          </p>
                        </li>
                        <li className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              doc_validity.nr
                            </h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Proves document expiration is valid.
                          </p>
                        </li>
                        <li className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              face_match.nr
                            </h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Proves face match meets a threshold without storing
                            biometrics.
                          </p>
                        </li>
                        <li className="p-4 rounded-xl border border-border bg-card/50 hover:bg-card transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                            <IconFileCode className="h-5 w-5 text-purple-400" />
                            <h4 className="font-semibold text-foreground">
                              nationality_membership.nr
                            </h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Proves nationality belongs to a group (EU, SCHENGEN)
                            via Merkle proof.
                          </p>
                        </li>
                      </ul>
                    </div>

                    {/* Code Preview */}
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/20 to-blue-500/20 rounded-xl blur-lg transition-opacity opacity-50 group-hover:opacity-100" />
                      <div className="relative bg-[#0d1117] rounded-xl border border-border/50 p-4 font-mono text-sm text-gray-300 shadow-xl overflow-hidden min-h-[300px]">
                        <div className="flex justify-between items-center text-xs text-gray-500 mb-4 pb-2 border-b border-gray-800">
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
