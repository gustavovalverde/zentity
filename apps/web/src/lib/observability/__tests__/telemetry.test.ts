import { beforeEach, describe, expect, it, vi } from "vitest";

const { otelEnv, sdkConfigs, autoInstrumentationConfigs } = vi.hoisted(() => ({
  otelEnv: {} as Record<string, unknown>,
  sdkConfigs: [] as Record<string, unknown>[],
  autoInstrumentationConfigs: [] as Record<string, unknown>[],
}));

vi.mock("@/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/env")>();
  return {
    ...mod,
    env: new Proxy(mod.env, {
      get(target, prop) {
        if (typeof prop === "string" && prop in otelEnv) {
          return otelEnv[prop];
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    constructor(config: Record<string, unknown>) {
      sdkConfigs.push(config);
    }
    start() {
      // The real SDK registers global providers here.
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: (config: Record<string, unknown>) => {
    autoInstrumentationConfigs.push(config);
    return [];
  },
}));

async function startTelemetry(env: Record<string, unknown>) {
  for (const key of Object.keys(otelEnv)) {
    delete otelEnv[key];
  }
  Object.assign(otelEnv, env);
  vi.resetModules();
  const { initTelemetry } = await import("../telemetry");
  await initTelemetry();
}

describe("initTelemetry", () => {
  beforeEach(() => {
    sdkConfigs.length = 0;
    autoInstrumentationConfigs.length = 0;
  });

  it("does not start the SDK when telemetry is not configured", async () => {
    await startTelemetry({
      OTEL_ENABLED: undefined,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
    });

    expect(sdkConfigs).toHaveLength(0);
  });

  it("leaves exporters to the OTEL_* environment and exports no logs", async () => {
    await startTelemetry({
      OTEL_ENABLED: undefined,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://collector:4318/v1/metrics",
    });

    expect(sdkConfigs).toHaveLength(1);
    const config = sdkConfigs[0];
    expect(config).not.toHaveProperty("traceExporter");
    expect(config).not.toHaveProperty("spanProcessors");
    expect(config).not.toHaveProperty("metricReaders");
    expect(config?.logRecordProcessors).toEqual([]);
    expect(autoInstrumentationConfigs[0]).toMatchObject({
      "@opentelemetry/instrumentation-pino": { disableLogSending: true },
    });
  });
});
