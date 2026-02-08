import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import { type NextRequest, NextResponse } from "next/server";

const CRS_DIR =
  process.env.BB_CRS_PATH || process.env.CRS_PATH || "/tmp/.bb-crs";

// CDN filenames → local pre-warmed filenames
const FILE_MAP: Record<string, string> = {
  "g1.dat": "bn254_g1.dat",
  "g2.dat": "bn254_g2.dat",
  "grumpkin_g1.dat": "grumpkin_g1.flat.dat",
};

const RANGE_PATTERN = /bytes=(\d+)-(\d*)/;

function resolveLocalFile(requested: string): string | null {
  const mapped = FILE_MAP[requested] ?? requested;
  // Only serve known CRS files
  if (!Object.values(FILE_MAP).includes(mapped)) {
    return null;
  }
  return mapped;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const requested = path.join("/");

  const localFile = resolveLocalFile(requested);
  if (!localFile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = join(CRS_DIR, localFile);

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    return NextResponse.json({ error: "CRS not pre-warmed" }, { status: 404 });
  }

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = RANGE_PATTERN.exec(rangeHeader);
    if (match) {
      const start = Number.parseInt(match[1], 10);
      const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(stream) as ReadableStream;

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
