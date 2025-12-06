declare module "snarkjs" {
  export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  }

  export interface FullProveResult {
    proof: Groth16Proof;
    publicSignals: string[];
  }

  export namespace groth16 {
    function fullProve(
      input: Record<string, string>,
      wasmFile: string,
      zkeyFileName: string
    ): Promise<FullProveResult>;

    function verify(
      vk: object,
      publicSignals: string[],
      proof: Groth16Proof
    ): Promise<boolean>;

    function exportSolidityCallData(
      proof: Groth16Proof,
      publicSignals: string[]
    ): Promise<string>;
  }
}
