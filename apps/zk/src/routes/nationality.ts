/**
 * Nationality Membership proof generation and verification routes
 *
 * POST /generate - Generate ZK proof that nationality is in a country group
 * POST /verify - Verify a nationality membership ZK proof
 * GET /groups - List available country groups
 * GET /groups/:name - Get countries in a specific group
 */

import { Router, Request, Response, NextFunction } from "express";
import type { Router as RouterType } from "express";
import type { Groth16Proof } from "snarkjs";
import {
  generateNationalityMembershipProof,
  verifyNationalityMembershipProof,
  exportNationalitySolidityCalldata,
  getAvailableGroups,
  getGroupCountries,
  getGroupMerkleRoot,
  isValidCountryCode,
  COUNTRY_CODES,
} from "../lib/nationality.js";

export const nationalityRouter: RouterType = Router();

interface GenerateNationalityBody {
  /** ISO 3166-1 alpha-3 country code (e.g., "DEU", "FRA", "DOM") */
  nationalityCode: string;
  /** Country group to prove membership (EU, SCHENGEN, EEA, LATAM, FIVE_EYES) */
  groupName: string;
}

interface VerifyNationalityBody {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Generate a nationality membership ZK proof
 *
 * POST /nationality/generate
 * Body: { nationalityCode: "DEU", groupName: "EU" }
 *
 * Returns proof that nationality is in the group without revealing which country
 */
nationalityRouter.post(
  "/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { nationalityCode, groupName } = req.body as GenerateNationalityBody;

      // Validate inputs
      if (!nationalityCode) {
        res.status(400).json({
          error: "nationalityCode is required (ISO 3166-1 alpha-3, e.g., 'DEU')",
        });
        return;
      }

      if (!groupName) {
        res.status(400).json({
          error: "groupName is required (EU, SCHENGEN, EEA, LATAM, FIVE_EYES)",
        });
        return;
      }

      const upperCode = nationalityCode.toUpperCase();
      if (!isValidCountryCode(upperCode)) {
        res.status(400).json({
          error: `Unknown country code: ${nationalityCode}`,
          availableCodes: Object.keys(COUNTRY_CODES),
        });
        return;
      }

      const availableGroups = getAvailableGroups();
      if (!availableGroups.includes(groupName.toUpperCase())) {
        res.status(400).json({
          error: `Unknown country group: ${groupName}`,
          availableGroups,
        });
        return;
      }

      console.log(
        `[Nationality] Generating proof: code=${upperCode}, group=${groupName}`
      );

      const result = await generateNationalityMembershipProof({
        nationalityCode: upperCode,
        groupName: groupName.toUpperCase(),
      });

      // Generate Solidity calldata for on-chain verification
      let solidityCalldata: string | null = null;
      try {
        solidityCalldata = await exportNationalitySolidityCalldata(
          result.proof,
          result.publicSignals
        );
      } catch {
        // Solidity export may fail for simulated proofs
      }

      console.log(
        `[Nationality] Proof generated in ${result.generationTimeMs}ms, isMember=${result.isMember}`
      );

      res.json({
        proof: result.proof,
        publicSignals: result.publicSignals,
        isMember: result.isMember,
        groupName: result.groupName,
        merkleRoot: result.merkleRoot,
        generationTimeMs: result.generationTimeMs,
        solidityCalldata,
      });
    } catch (error) {
      console.error("[Nationality] Proof generation error:", error);
      next(error);
    }
  }
);

/**
 * Verify a nationality membership ZK proof
 *
 * POST /nationality/verify
 * Body: { proof: {...}, publicSignals: [...] }
 *
 * Returns whether the proof is valid
 */
nationalityRouter.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { proof, publicSignals } = req.body as VerifyNationalityBody;

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
        `[Nationality] Verifying proof with ${publicSignals.length} public signals`
      );

      const result = await verifyNationalityMembershipProof(proof, publicSignals);

      console.log(
        `[Nationality] Verification complete in ${result.verificationTimeMs}ms, isValid=${result.isValid}`
      );

      res.json({
        isValid: result.isValid,
        proofIsMember: result.proofIsMember,
        merkleRoot: result.merkleRoot,
        verificationTimeMs: result.verificationTimeMs,
      });
    } catch (error) {
      console.error("[Nationality] Proof verification error:", error);
      next(error);
    }
  }
);

/**
 * List available country groups
 *
 * GET /nationality/groups
 */
nationalityRouter.get(
  "/groups",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const groups = getAvailableGroups();
      const groupInfo = await Promise.all(
        groups.map(async (name) => ({
          name,
          merkleRoot: await getGroupMerkleRoot(name),
          countryCount: getGroupCountries(name).length,
        }))
      );

      res.json({
        groups: groupInfo,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get countries in a specific group
 *
 * GET /nationality/groups/:name
 */
nationalityRouter.get(
  "/groups/:name",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.params;
      const upperName = name.toUpperCase();

      const countries = getGroupCountries(upperName);
      if (countries.length === 0) {
        res.status(404).json({
          error: `Unknown country group: ${name}`,
          availableGroups: getAvailableGroups(),
        });
        return;
      }

      res.json({
        name: upperName,
        merkleRoot: await getGroupMerkleRoot(upperName),
        countries,
        countryCount: countries.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Check if a country is in a group (without generating proof)
 *
 * GET /nationality/check?code=DEU&group=EU
 */
nationalityRouter.get(
  "/check",
  (req: Request, res: Response) => {
    const { code, group } = req.query;

    if (!code || !group) {
      res.status(400).json({
        error: "Both 'code' and 'group' query parameters are required",
      });
      return;
    }

    const upperCode = String(code).toUpperCase();
    const upperGroup = String(group).toUpperCase();

    if (!isValidCountryCode(upperCode)) {
      res.status(400).json({
        error: `Unknown country code: ${code}`,
      });
      return;
    }

    const countries = getGroupCountries(upperGroup);
    if (countries.length === 0) {
      res.status(400).json({
        error: `Unknown country group: ${group}`,
        availableGroups: getAvailableGroups(),
      });
      return;
    }

    const isMember = countries.includes(upperCode);

    res.json({
      nationalityCode: upperCode,
      groupName: upperGroup,
      isMember,
    });
  }
);
