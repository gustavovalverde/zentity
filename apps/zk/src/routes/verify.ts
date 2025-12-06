/**
 * Proof verification route
 */

import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import { verifyProof } from "../lib/snarkjs.js";
import type { Groth16Proof } from "snarkjs";

export const verifyRouter: RouterType = Router();

interface VerifyProofBody {
  proof: Groth16Proof;
  publicSignals: string[];
}

verifyRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { proof, publicSignals } = req.body as VerifyProofBody;

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

      console.log(`Verifying proof with ${publicSignals.length} public signals`);

      const result = await verifyProof(proof, publicSignals);

      res.json({
        isValid: result.isValid,
        verificationTimeMs: result.verificationTimeMs,
      });
    } catch (error) {
      next(error);
    }
  }
);
