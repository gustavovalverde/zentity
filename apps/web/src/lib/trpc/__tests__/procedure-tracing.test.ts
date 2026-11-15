import type {
  Attributes,
  Span,
  SpanOptions,
  SpanStatus,
  Tracer,
} from "@opentelemetry/api";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { protectedProcedure, publicProcedure, router } from "@/lib/trpc/server";

interface RecordedSpan {
  attributes: Attributes;
  ended: boolean;
  name: string;
  status?: SpanStatus;
}

const recorded: RecordedSpan[] = [];

function startRecordingSpan(name: string, options?: SpanOptions): Span {
  const entry: RecordedSpan = {
    attributes: { ...options?.attributes },
    ended: false,
    name,
  };
  recorded.push(entry);
  const span: Span = {
    spanContext: () => ({
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
      traceId: "0af7651916cd43dd8448eb211c80319c",
    }),
    setAttribute: (key, value) => {
      entry.attributes[key] = value;
      return span;
    },
    setAttributes: (attributes) => {
      Object.assign(entry.attributes, attributes);
      return span;
    },
    addEvent: () => span,
    addLink: () => span,
    addLinks: () => span,
    setStatus: (status) => {
      entry.status = status;
      return span;
    },
    updateName: () => span,
    end: () => {
      entry.ended = true;
    },
    isRecording: () => true,
    recordException: () => undefined,
  };
  return span;
}

const recordingTracer = {
  startSpan: startRecordingSpan,
  startActiveSpan: (
    name: string,
    options: SpanOptions,
    run: (span: Span) => unknown
  ) => run(startRecordingSpan(name, options)),
} as unknown as Tracer;

const testRouter = router({
  succeeds: publicProcedure.query(() => "ok"),
  rejectsInput: publicProcedure.query(() => {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid input" });
  }),
  crashes: publicProcedure.query(() => {
    throw new Error("database unavailable");
  }),
  requiresSession: protectedProcedure.query(() => "secret"),
});

const caller = testRouter.createCaller({
  flowId: null,
  flowIdSource: "none",
  req: new Request("http://localhost/api/trpc"),
  requestId: "test-request-id",
  resHeaders: new Headers(),
  session: null,
});

function spanFor(path: string): RecordedSpan {
  const span = recorded.find((entry) => entry.name === `trpc.${path}`);
  if (!span) {
    throw new Error(`no span recorded for ${path}`);
  }
  return span;
}

describe("tRPC procedure spans", () => {
  beforeAll(() => {
    trace.setGlobalTracerProvider({ getTracer: () => recordingTracer });
  });

  afterAll(() => {
    trace.disable();
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("marks a procedure that fails with a server error as ERROR", async () => {
    await expect(caller.crashes()).rejects.toThrow("database unavailable");

    const span = spanFor("crashes");
    expect(span.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: "INTERNAL_SERVER_ERROR",
    });
    expect(span.attributes).toMatchObject({
      "error.type": "INTERNAL_SERVER_ERROR",
      "rpc.status_code": "INTERNAL_SERVER_ERROR",
    });
    expect(span.ended).toBe(true);
  });

  it("records client errors without marking the span ERROR", async () => {
    await expect(caller.rejectsInput()).rejects.toThrow("invalid input");
    await expect(caller.requiresSession()).rejects.toThrow("UNAUTHORIZED");

    expect(spanFor("rejectsInput").status).toBeUndefined();
    expect(spanFor("rejectsInput").attributes).toMatchObject({
      "error.type": "BAD_REQUEST",
      "rpc.status_code": "BAD_REQUEST",
    });
    expect(spanFor("requiresSession").status).toBeUndefined();
    expect(spanFor("requiresSession").attributes).toMatchObject({
      "rpc.status_code": "UNAUTHORIZED",
    });
  });

  it("leaves a successful procedure's status unset", async () => {
    await expect(caller.succeeds()).resolves.toBe("ok");

    const span = spanFor("succeeds");
    expect(span.status).toBeUndefined();
    expect(span.attributes["rpc.status_code"]).toBeUndefined();
    expect(span.attributes).toMatchObject({
      "rpc.method": "succeeds",
      "request.id": "test-request-id",
    });
    expect(span.ended).toBe(true);
  });
});
