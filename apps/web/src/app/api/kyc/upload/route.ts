import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import Database from "better-sqlite3";
import { ensureKycStatus, calculateKycLevel } from "../route";

const db = new Database("./dev.db");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export interface UploadResponse {
  documentId: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  status: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<UploadResponse | { error: string }>> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentType = formData.get("documentType") as string | null;
    const metadata = formData.get("metadata") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!documentType || !["id_document", "selfie"].includes(documentType)) {
      return NextResponse.json(
        { error: "Invalid document type. Must be 'id_document' or 'selfie'" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB" },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        {
          error:
            "Invalid file type. Allowed: JPEG, PNG, WebP, PDF",
        },
        { status: 400 }
      );
    }

    // PRIVACY: We do NOT store file bytes - only metadata for tracking
    // The actual image is processed transiently during verification and discarded
    const documentId = crypto.randomUUID();
    const userId = session.user.id;

    // Insert document METADATA only (no file_data) into database
    const insertStmt = db.prepare(`
      INSERT INTO kyc_documents (
        id, user_id, document_type, file_name,
        file_mime_type, file_size, status, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    insertStmt.run(
      documentId,
      userId,
      documentType,
      file.name,
      file.type,
      file.size,
      metadata || null
    );

    // Ensure KYC status record exists
    ensureKycStatus(userId);

    // Update KYC status based on document type
    const updateFields =
      documentType === "id_document"
        ? "document_uploaded = 1"
        : "selfie_uploaded = 1";

    db.prepare(
      `UPDATE kyc_status SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`
    ).run(userId);

    // Get current status to calculate KYC level
    const statusStmt = db.prepare(`
      SELECT document_uploaded, document_verified, selfie_uploaded, selfie_verified
      FROM kyc_status WHERE user_id = ?
    `);
    const status = statusStmt.get(userId) as {
      document_uploaded: number;
      document_verified: number;
      selfie_uploaded: number;
      selfie_verified: number;
    };

    const kycLevel = calculateKycLevel(
      Boolean(status.document_uploaded),
      Boolean(status.document_verified),
      Boolean(status.selfie_uploaded),
      Boolean(status.selfie_verified)
    );

    // Update KYC level
    db.prepare(
      `UPDATE kyc_status SET kyc_level = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`
    ).run(kycLevel, userId);

    return NextResponse.json({
      documentId,
      documentType,
      fileName: file.name,
      fileSize: file.size,
      status: "pending",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload document" },
      { status: 500 }
    );
  }
}

// GET - Retrieve uploaded documents for the current user
export async function GET(
  request: NextRequest
): Promise<NextResponse<{ documents: object[] } | { error: string }>> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const documentType = searchParams.get("type");

    let query = `
      SELECT id, document_type, file_name, file_mime_type, file_size,
             status, metadata, created_at, verified_at
      FROM kyc_documents
      WHERE user_id = ?
    `;
    const params: string[] = [session.user.id];

    if (documentType) {
      query += " AND document_type = ?";
      params.push(documentType);
    }

    query += " ORDER BY created_at DESC";

    const stmt = db.prepare(query);
    const documents = stmt.all(...params) as object[];

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Get documents error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve documents" },
      { status: 500 }
    );
  }
}
