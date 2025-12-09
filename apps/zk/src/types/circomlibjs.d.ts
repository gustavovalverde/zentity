declare module "circomlibjs" {
  export interface FieldElement {
    toString(): string;
  }

  export interface PoseidonF {
    e(value: bigint | number | string): FieldElement;
    toObject(element: FieldElement): bigint;
  }

  export interface PoseidonHashFunction {
    (inputs: FieldElement[]): FieldElement;
    F: PoseidonF;
  }

  export function buildPoseidon(): Promise<PoseidonHashFunction>;
}
