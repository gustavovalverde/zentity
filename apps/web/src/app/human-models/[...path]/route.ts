import { readFile } from "node:fs/promises";
import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { HUMAN_MODELS_DIR } from "@/lib/human-models-path";

export const runtime = "nodejs";

const MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".model": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path: parts } = await context.params;
  const safeParts = Array.isArray(parts) ? parts : [];
  const relativePath = safeParts.join("/");
  const root = path.resolve(HUMAN_MODELS_DIR);
  const candidate = path.resolve(path.join(root, relativePath));
  const normalizedRoot = root + path.sep;

  // Prevent path traversal
  if (!candidate.startsWith(normalizedRoot)) {
    return NextResponse.json({ error: "Invalid model path" }, { status: 400 });
  }

  try {
    const data = await readFile(candidate);
    const ext = path.extname(candidate).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (_error) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }
}
