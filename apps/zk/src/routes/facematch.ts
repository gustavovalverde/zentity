/**
 * Face Match proof generation and verification routes
 *
 * POST /generate - Generate ZK proof that similarity >= threshold
 * POST /verify - Verify a face match ZK proof
 */

import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import type { Groth16Proof } from "snarkjs";
import {
  generateFaceMatchProof,
  verifyFaceMatchProof,
  exportFaceMatchSolidityCalldata,
} from "../lib/facematch.js";

export const facematchRouter: RouterType = Router();

interface GenerateFaceMatchBody {
  /** Similarity score from face comparison (0.0-1.0) */
  similarityScore: number;
  /** Minimum threshold for match (0.0-1.0), defaults to 0.6 */
  threshold?: number;
}

interface VerifyFaceMatchBody {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Generate a face match ZK proof
 *
 * POST /facematch/generate
 * Body: { similarityScore: 0.73, threshold: 0.6 }
 *
 * Returns proof that similarityScore >= threshold without revealing exact score
 */
facematchRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { similarityScore, threshold = 0.6 } =
        req.body as GenerateFaceMatchBody;

      // Validate inputs
      if (similarityScore === undefined || similarityScore === null) {
        res.status(400).json({
          error: "similarityScore is required",
        });
        return;
      }

      if (typeof similarityScore !== "number" || isNaN(similarityScore)) {
        res.status(400).json({
          error: "similarityScore must be a number",
        });
        return;
      }

      if (similarityScore < 0 || similarityScore > 1) {
        res.status(400).json({
          error: "similarityScore must be between 0.0 and 1.0",
        });
        return;
      }

      if (threshold < 0 || threshold > 1) {
        res.status(400).json({
          error: "threshold must be between 0.0 and 1.0",
        });
        return;
      }

      console.log(
        `[FaceMatch] Generating proof: score=${similarityScore.toFixed(4)}, threshold=${threshold}`
      );

      const result = await generateFaceMatchProof({
        similarityScore,
        threshold,
      });

      // Generate Solidity calldata for on-chain verification
      const solidityCalldata = await exportFaceMatchSolidityCalldata(
        result.proof,
        result.publicSignals
      );

      console.log(
        `[FaceMatch] Proof generated in ${result.generationTimeMs}ms, isMatch=${result.isMatch}`
      );

      res.json({
        proof: result.proof,
        publicSignals: result.publicSignals,
        isMatch: result.isMatch,
        threshold: result.threshold,
        generationTimeMs: result.generationTimeMs,
        solidityCalldata,
      });
    } catch (error) {
      console.error("[FaceMatch] Proof generation error:", error);
      next(error);
    }
  }
);

/**
 * Verify a face match ZK proof
 *
 * POST /facematch/verify
 * Body: { proof: {...}, publicSignals: [...] }
 *
 * Returns whether the proof is valid
 */
facematchRouter.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { proof, publicSignals } = req.body as VerifyFaceMatchBody;

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
        `[FaceMatch] Verifying proof with ${publicSignals.length} public signals`
      );

      const result = await verifyFaceMatchProof(proof, publicSignals);

      console.log(
        `[FaceMatch] Verification complete in ${result.verificationTimeMs}ms, isValid=${result.isValid}`
      );

      res.json({
        isValid: result.isValid,
        threshold: result.threshold,
        verificationTimeMs: result.verificationTimeMs,
      });
    } catch (error) {
      console.error("[FaceMatch] Proof verification error:", error);
      next(error);
    }
  }
);
