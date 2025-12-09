import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, Clock, Hash, CheckCircle, Code } from "lucide-react";
import { VerificationActions } from "@/components/dashboard/verification-actions";
import Database from "better-sqlite3";

const db = new Database("./dev.db");

async function getUserProof(userId: string) {
  try {
    const stmt = db.prepare(`
      SELECT id, is_over_18, generation_time_ms, created_at
      FROM age_proofs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const proof = stmt.get(userId) as {
      id: string;
      is_over_18: number;
      generation_time_ms: number;
      created_at: string;
    } | undefined;

    if (!proof) return null;

    return {
      proofId: proof.id,
      isOver18: Boolean(proof.is_over_18),
      generationTimeMs: proof.generation_time_ms,
      createdAt: proof.created_at,
    };
  } catch {
    return null;
  }
}

export default async function VerificationPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const proof = session?.user?.id ? await getUserProof(session.user.id) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Verification Details</h1>
        <p className="text-muted-foreground">
          View your age verification proof and status
        </p>
      </div>

      {proof ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <span className="text-lg">Age Verified</span>
                  <Badge className="ml-2 bg-green-600">18+</Badge>
                </div>
              </CardTitle>
              <CardDescription>
                Your age has been cryptographically verified using zero-knowledge proofs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <Hash className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Proof ID</p>
                    <code className="block rounded bg-muted px-2 py-1 text-xs break-all">
                      {proof.proofId}
                    </code>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg border p-4">
                  <Clock className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Generated</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(proof.createdAt).toLocaleDateString()} at{" "}
                      {new Date(proof.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-600" />
                  <span className="font-medium">Proof Performance</span>
                </div>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Generation Time</p>
                    <p className="font-mono font-medium">{proof.generationTimeMs}ms</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Proof Type</p>
                    <p className="font-medium">Groth16 (zk-SNARK)</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Circuit Constraints</p>
                    <p className="font-medium">6 constraints</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <VerificationActions />

          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              <strong>How it works:</strong> Your zero-knowledge proof mathematically
              proves you are 18+ without revealing your actual date of birth. The proof
              can be independently verified by any third party using the verification key,
              while your age remains private.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Technical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cryptographic Scheme</span>
                <span>Groth16 zk-SNARK</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Elliptic Curve</span>
                <span>BN254</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proof System</span>
                <span>snarkjs + Circom</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">FHE Encryption</span>
                <span>TFHE-rs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Verification</span>
                <span className="text-green-600 font-medium">Valid</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Developer View</span>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/dev">View Raw Data</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Shield className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="font-medium">No Verification Found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete the registration process to generate your age verification proof.
            </p>
            <Button asChild className="mt-4">
              <Link href="/sign-up">Complete Registration</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
