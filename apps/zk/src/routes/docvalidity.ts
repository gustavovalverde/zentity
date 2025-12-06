/**
 * Document Validity proof generation and verification routes
 *
 * POST /generate - Generate ZK proof that document is not expired
 * POST /verify - Verify a document validity ZK proof
 */

import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import type { Groth16Proof } from "snarkjs";
import {
  generateDocValidityProof,
  verifyDocValidityProof,
  exportDocValiditySolidityCalldata,
  dateToInt,
  getCurrentDateInt,
} from "../lib/docvalidity.js";

export const docvalidityRouter: RouterType = Router();

interface GenerateDocValidityBody {
  /** Expiry date as YYYYMMDD integer or YYYY-MM-DD string */
  expiryDate: number | string;
  /** Current date as YYYYMMDD integer or YYYY-MM-DD string (optional, defaults to today) */
  currentDate?: number | string;
}

interface VerifyDocValidityBody {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Parse date input (accepts YYYYMMDD int or YYYY-MM-DD string)
 */
function parseDateInput(input: number | string): number {
  if (typeof input === "number") {
    return input;
  }
  // Handle YYYY-MM-DD string format
  if (typeof input === "string" && input.includes("-")) {
    return dateToInt(input);
  }
  // Handle YYYYMMDD string format
  return parseInt(input, 10);
}

/**
 * Generate a document validity ZK proof
 *
 * POST /docvalidity/generate
 * Body: { expiryDate: 20251231 } or { expiryDate: "2025-12-31" }
 *
 * Returns proof that document expiry > current date without revealing expiry
 */
docvalidityRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { expiryDate, currentDate } = req.body as GenerateDocValidityBody;

      // Validate inputs
      if (expiryDate === undefined || expiryDate === null) {
        res.status(400).json({
          error: "expiryDate is required",
        });
        return;
      }

      let parsedExpiry: number;
      let parsedCurrent: number;

      try {
        parsedExpiry = parseDateInput(expiryDate);
      } catch {
        res.status(400).json({
          error: "expiryDate must be YYYYMMDD integer or YYYY-MM-DD string",
        });
        return;
      }

      if (currentDate !== undefined && currentDate !== null) {
        try {
          parsedCurrent = parseDateInput(currentDate);
        } catch {
          res.status(400).json({
            error: "currentDate must be YYYYMMDD integer or YYYY-MM-DD string",
          });
          return;
        }
      } else {
        parsedCurrent = getCurrentDateInt();
      }

      console.log(
        `[DocValidity] Generating proof: expiry=${parsedExpiry}, current=${parsedCurrent}`
      );

      const result = await generateDocValidityProof({
        expiryDate: parsedExpiry,
        currentDate: parsedCurrent,
      });

      // Generate Solidity calldata for on-chain verification
      const solidityCalldata = await exportDocValiditySolidityCalldata(
        result.proof,
        result.publicSignals
      );

      console.log(
        `[DocValidity] Proof generated in ${result.generationTimeMs}ms, isValid=${result.isValid}`
      );

      res.json({
        proof: result.proof,
        publicSignals: result.publicSignals,
        isValid: result.isValid,
        currentDate: result.currentDate,
        generationTimeMs: result.generationTimeMs,
        solidityCalldata,
      });
    } catch (error) {
      console.error("[DocValidity] Proof generation error:", error);
      next(error);
    }
  }
);

/**
 * Verify a document validity ZK proof
 *
 * POST /docvalidity/verify
 * Body: { proof: {...}, publicSignals: [...] }
 *
 * Returns whether the proof is valid
 */
docvalidityRouter.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { proof, publicSignals } = req.body as VerifyDocValidityBody;

      // Validate inputs
      if (!proof || !publicSignals) {
        res.status(400).json({
          error: "proof and publicSignals are required",
        });
        return;
      }

      if (!Array.isArray(publicSignals)) {
        res.status(400).json({
          error: "publicSignals must be an array",
        });
        return;
      }

      console.log(
        `[DocValidity] Verifying proof with ${publicSignals.length} public signals`
      );

      const result = await verifyDocValidityProof(proof, publicSignals);

      console.log(
        `[DocValidity] Verification complete in ${result.verificationTimeMs}ms, isValid=${result.isValid}`
      );

      res.json({
        isValid: result.isValid,
        currentDate: result.currentDate,
        proofIsValid: result.proofIsValid,
        verificationTimeMs: result.verificationTimeMs,
      });
    } catch (error) {
      console.error("[DocValidity] Proof verification error:", error);
      next(error);
    }
  }
);
