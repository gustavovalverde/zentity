import { db } from "./kyc-db";

// Helper function to create or update KYC status
export function ensureKycStatus(userId: string): void {
  const checkStmt = db.prepare(`SELECT id FROM kyc_status WHERE user_id = ?`);
  const existing = checkStmt.get(userId);

  if (!existing) {
    const insertStmt = db.prepare(`
      INSERT INTO kyc_status (id, user_id, kyc_level)
      VALUES (?, ?, 'none')
    `);
    insertStmt.run(crypto.randomUUID(), userId);
  }
}

// Helper function to calculate KYC level
export function calculateKycLevel(
  documentUploaded: boolean,
  documentVerified: boolean,
  selfieUploaded: boolean,
  selfieVerified: boolean,
): "none" | "basic" | "enhanced" | "full" {
  if (documentVerified && selfieVerified) return "full";
  if (documentVerified || selfieVerified) return "enhanced";
  if (documentUploaded || selfieUploaded) return "basic";
  return "none";
}
