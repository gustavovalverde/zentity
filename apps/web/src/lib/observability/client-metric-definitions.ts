export const CLIENT_METRIC_DEFINITIONS = {
  "client.noir.proof.duration": {
    unit: "ms",
    attributes: ["proof_type", "result", "flow_present"],
  },
  "client.noir.proof.bytes": {
    unit: "By",
    attributes: ["proof_type", "flow_present"],
  },
  "client.fhevm.encrypt.duration": {
    unit: "ms",
    attributes: ["result", "flow_present"],
  },
  "client.fhevm.encrypt.proof.bytes": {
    unit: "By",
    attributes: ["flow_present"],
  },
  "client.fhevm.decrypt.duration": {
    unit: "ms",
    attributes: ["result", "flow_present"],
  },
  "client.fhevm.init.duration": {
    unit: "ms",
    attributes: ["result", "provider_id", "chain_type"],
  },
  "client.tfhe.load.duration": {
    unit: "ms",
    attributes: ["result", "multithreaded"],
  },
  "client.tfhe.load.retry": {
    unit: "ms",
    attributes: ["attempt", "error"],
  },
  "client.tfhe.keygen.duration": {
    unit: "ms",
    attributes: ["result", "flow_present"],
  },
  "client.passkey.duration": {
    unit: "ms",
    attributes: [
      "operation",
      "result",
      "prf_enabled",
      "credential_bucket",
      "flow_present",
    ],
  },
} as const;

export type ClientMetricName = keyof typeof CLIENT_METRIC_DEFINITIONS;
export type ClientMetricUnit =
  (typeof CLIENT_METRIC_DEFINITIONS)[ClientMetricName]["unit"];
