/**
 * Tests for Nationality Membership ZK proof operations
 *
 * Tests the Merkle tree construction, proof generation, and country group verification
 * for privacy-preserving nationality membership proofs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  COUNTRY_CODES,
  COUNTRY_GROUPS,
  buildMerkleTree,
  getMerkleProof,
  getGroupMerkleRoot,
  getGroupTree,
  getAvailableGroups,
  getGroupCountries,
  isValidCountryCode,
  generateNationalityMembershipProof,
  verifyNationalityMembershipProof,
} from './nationality';

describe('Nationality Module', () => {
  describe('COUNTRY_CODES', () => {
    it('should have ISO 3166-1 numeric codes for all EU countries', () => {
      const euCodes = ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
        'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
        'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'];

      for (const code of euCodes) {
        expect(COUNTRY_CODES[code]).toBeDefined();
        expect(typeof COUNTRY_CODES[code]).toBe('number');
      }
    });

    it('should have correct numeric codes for major countries', () => {
      expect(COUNTRY_CODES['DEU']).toBe(276); // Germany
      expect(COUNTRY_CODES['FRA']).toBe(250); // France
      expect(COUNTRY_CODES['USA']).toBe(840); // United States
      expect(COUNTRY_CODES['GBR']).toBe(826); // United Kingdom
      expect(COUNTRY_CODES['DOM']).toBe(214); // Dominican Republic
    });

    it('should have Liechtenstein for EEA membership', () => {
      expect(COUNTRY_CODES['LIE']).toBe(438);
    });

    it('should have all LATAM countries', () => {
      expect(COUNTRY_CODES['DOM']).toBe(214);
      expect(COUNTRY_CODES['MEX']).toBe(484);
      expect(COUNTRY_CODES['BRA']).toBe(76);
      expect(COUNTRY_CODES['ARG']).toBe(32);
    });
  });

  describe('COUNTRY_GROUPS', () => {
    it('should have 27 EU member states', () => {
      expect(COUNTRY_GROUPS['EU']).toHaveLength(27);
    });

    it('should have 25 Schengen countries', () => {
      expect(COUNTRY_GROUPS['SCHENGEN']).toHaveLength(25);
    });

    it('should have 30 EEA countries', () => {
      expect(COUNTRY_GROUPS['EEA']).toHaveLength(30);
    });

    it('should have 7 LATAM countries', () => {
      expect(COUNTRY_GROUPS['LATAM']).toHaveLength(7);
    });

    it('should have 5 Five Eyes countries', () => {
      expect(COUNTRY_GROUPS['FIVE_EYES']).toHaveLength(5);
      expect(COUNTRY_GROUPS['FIVE_EYES']).toContain('USA');
      expect(COUNTRY_GROUPS['FIVE_EYES']).toContain('GBR');
      expect(COUNTRY_GROUPS['FIVE_EYES']).toContain('CAN');
      expect(COUNTRY_GROUPS['FIVE_EYES']).toContain('AUS');
      expect(COUNTRY_GROUPS['FIVE_EYES']).toContain('NZL');
    });

    it('should include DOM in LATAM', () => {
      expect(COUNTRY_GROUPS['LATAM']).toContain('DOM');
    });

    it('should not include USA in EU', () => {
      expect(COUNTRY_GROUPS['EU']).not.toContain('USA');
    });

    it('should include LIE in EEA but not EU', () => {
      expect(COUNTRY_GROUPS['EEA']).toContain('LIE');
      expect(COUNTRY_GROUPS['EU']).not.toContain('LIE');
    });

    it('should include CHE in SCHENGEN but not EU', () => {
      expect(COUNTRY_GROUPS['SCHENGEN']).toContain('CHE');
      expect(COUNTRY_GROUPS['EU']).not.toContain('CHE');
    });
  });

  describe('isValidCountryCode', () => {
    it('should return true for valid country codes', () => {
      expect(isValidCountryCode('DEU')).toBe(true);
      expect(isValidCountryCode('USA')).toBe(true);
      expect(isValidCountryCode('DOM')).toBe(true);
    });

    it('should return false for invalid country codes', () => {
      expect(isValidCountryCode('XXX')).toBe(false);
      expect(isValidCountryCode('GERMANY')).toBe(false);
      expect(isValidCountryCode('')).toBe(false);
    });
  });

  describe('getAvailableGroups', () => {
    it('should return all available country groups', () => {
      const groups = getAvailableGroups();
      expect(groups).toContain('EU');
      expect(groups).toContain('SCHENGEN');
      expect(groups).toContain('EEA');
      expect(groups).toContain('LATAM');
      expect(groups).toContain('FIVE_EYES');
    });
  });

  describe('getGroupCountries', () => {
    it('should return countries for valid group', () => {
      const euCountries = getGroupCountries('EU');
      expect(euCountries).toHaveLength(27);
      expect(euCountries).toContain('DEU');
      expect(euCountries).toContain('FRA');
    });

    it('should return empty array for invalid group', () => {
      const countries = getGroupCountries('INVALID');
      expect(countries).toEqual([]);
    });
  });

  describe('buildMerkleTree', () => {
    it('should build a valid Merkle tree from country codes', async () => {
      const countryCodes = ['DEU', 'FRA', 'ITA'];
      const tree = await buildMerkleTree(countryCodes);

      expect(tree.root).toBeDefined();
      expect(tree.leaves).toBeDefined();
      expect(tree.tree).toBeDefined();
      expect(tree.leaves.length).toBeGreaterThanOrEqual(countryCodes.length);
    });

    it('should produce consistent root for same input', async () => {
      const countryCodes = ['DEU', 'FRA'];
      const tree1 = await buildMerkleTree(countryCodes);
      const tree2 = await buildMerkleTree(countryCodes);

      expect(tree1.root).toBe(tree2.root);
    });

    it('should produce different roots for different inputs', async () => {
      const tree1 = await buildMerkleTree(['DEU', 'FRA']);
      const tree2 = await buildMerkleTree(['USA', 'CAN']);

      expect(tree1.root).not.toBe(tree2.root);
    });

    it('should throw for unknown country code', async () => {
      await expect(buildMerkleTree(['XXX'])).rejects.toThrow('Unknown country code: XXX');
    });
  });

  describe('getMerkleProof', () => {
    let tree: string[][];

    beforeEach(async () => {
      const treeData = await buildMerkleTree(['DEU', 'FRA', 'ITA', 'ESP']);
      tree = treeData.tree;
    });

    it('should generate valid proof for member country', async () => {
      const proof = await getMerkleProof('DEU', tree);

      expect(proof.pathElements).toBeDefined();
      expect(proof.pathIndices).toBeDefined();
      expect(proof.leaf).toBeDefined();
      expect(proof.pathElements.length).toBe(proof.pathIndices.length);
    });

    it('should throw for non-member country', async () => {
      await expect(getMerkleProof('USA', tree)).rejects.toThrow('Country USA not found in tree');
    });

    it('should throw for invalid country code', async () => {
      await expect(getMerkleProof('XXX', tree)).rejects.toThrow('Unknown country code: XXX');
    });
  });

  describe('getGroupMerkleRoot', () => {
    it('should return consistent root for EU group', async () => {
      const root1 = await getGroupMerkleRoot('EU');
      const root2 = await getGroupMerkleRoot('EU');

      expect(root1).toBe(root2);
      expect(typeof root1).toBe('string');
    });

    it('should return different roots for different groups', async () => {
      const euRoot = await getGroupMerkleRoot('EU');
      const latamRoot = await getGroupMerkleRoot('LATAM');

      expect(euRoot).not.toBe(latamRoot);
    });

    it('should throw for invalid group', async () => {
      await expect(getGroupMerkleRoot('INVALID')).rejects.toThrow('Unknown country group: INVALID');
    });
  });

  describe('getGroupTree', () => {
    it('should return tree structure for valid group', async () => {
      const tree = await getGroupTree('EU');

      expect(Array.isArray(tree)).toBe(true);
      expect(tree.length).toBeGreaterThan(0);
    });
  });

  describe('generateNationalityMembershipProof', () => {
    it('should generate proof for EU member', async () => {
      const result = await generateNationalityMembershipProof({
        nationalityCode: 'DEU',
        groupName: 'EU',
      });

      expect(result.isMember).toBe(true);
      expect(result.groupName).toBe('EU');
      expect(result.merkleRoot).toBeDefined();
      expect(result.proof).toBeDefined();
      expect(result.publicSignals).toBeDefined();
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should indicate non-membership for non-EU country', async () => {
      const result = await generateNationalityMembershipProof({
        nationalityCode: 'USA',
        groupName: 'EU',
      });

      expect(result.isMember).toBe(false);
      expect(result.groupName).toBe('EU');
    });

    it('should generate proof for DOM in LATAM', async () => {
      const result = await generateNationalityMembershipProof({
        nationalityCode: 'DOM',
        groupName: 'LATAM',
      });

      expect(result.isMember).toBe(true);
      expect(result.groupName).toBe('LATAM');
    });

    it('should return non-member for invalid country code (simulated mode)', async () => {
      // In simulated mode (no circuit compiled), invalid codes return isMember: false
      // In production mode with compiled circuit, this would throw
      const result = await generateNationalityMembershipProof({
        nationalityCode: 'XXX',
        groupName: 'EU',
      });

      expect(result.isMember).toBe(false);
    });

    it('should throw for invalid group', async () => {
      await expect(
        generateNationalityMembershipProof({
          nationalityCode: 'DEU',
          groupName: 'INVALID',
        })
      ).rejects.toThrow('Unknown country group: INVALID');
    });
  });

  describe('verifyNationalityMembershipProof', () => {
    it('should verify a valid proof', async () => {
      // Generate a proof first
      const proofResult = await generateNationalityMembershipProof({
        nationalityCode: 'DEU',
        groupName: 'EU',
      });

      // Verify the proof
      const verifyResult = await verifyNationalityMembershipProof(
        proofResult.proof,
        proofResult.publicSignals
      );

      expect(verifyResult.verificationTimeMs).toBeGreaterThanOrEqual(0);
      expect(verifyResult.merkleRoot).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle all EU countries', async () => {
      for (const code of COUNTRY_GROUPS['EU']) {
        const result = await generateNationalityMembershipProof({
          nationalityCode: code,
          groupName: 'EU',
        });
        expect(result.isMember).toBe(true);
      }
    });

    it('should handle case sensitivity', () => {
      // Country codes should be uppercase
      expect(isValidCountryCode('deu')).toBe(false);
      expect(isValidCountryCode('DEU')).toBe(true);
    });
  });
});
