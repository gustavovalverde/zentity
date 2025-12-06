/**
 * Proof generation route
 */

import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import { generateProof, exportSolidityCalldata } from "../lib/snarkjs.js";

export const proofRouter: RouterType = Router();

interface GenerateProofBody {
  birthYear: number;
  currentYear: number;
  minAge?: number;
}

proofRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { birthYear, currentYear, minAge = 18 } = req.body as GenerateProofBody;

      // Validate inputs
      if (!birthYear || !currentYear) {
        res.status(400).json({
          error: "birthYear and currentYear are required",
        });
        return;
      }

      if (birthYear < 1900 || birthYear > currentYear) {
        res.status(400).json({
          error: "Invalid birthYear",
        });
        return;
      }

      console.log(
        `Generating proof for birthYear=${birthYear}, currentYear=${currentYear}, minAge=${minAge}`
      );

      const result = await generateProof({
        birthYear,
        currentYear,
        minAge,
      });

      // Optionally include Solidity calldata
      const solidityCalldata = await exportSolidityCalldata(
        result.proof,
        result.publicSignals
      );

      res.json({
        proof: result.proof,
        publicSignals: result.publicSignals,
        generationTimeMs: result.generationTimeMs,
        solidityCalldata,
      });
    } catch (error) {
      next(error);
    }
  }
);
