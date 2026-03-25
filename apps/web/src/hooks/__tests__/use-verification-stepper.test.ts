// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useVerificationStepper } from "../use-verification-stepper";

describe("useVerificationStepper", () => {
  it("initializes with the given step", () => {
    const { result } = renderHook(() => useVerificationStepper("method"));
    expect(result.current.currentStep).toBe("method");
    expect(result.current.visitedSteps.has("method")).toBe(true);
    expect(result.current.visitedSteps.size).toBe(1);
  });

  it("advances to a valid next step", () => {
    const { result } = renderHook(() => useVerificationStepper("method"));
    act(() => result.current.goTo("document"));
    expect(result.current.currentStep).toBe("document");
    expect(result.current.visitedSteps.has("method")).toBe(true);
    expect(result.current.visitedSteps.has("document")).toBe(true);
  });

  it("throws on invalid transition", () => {
    const { result } = renderHook(() => useVerificationStepper("enrollment"));
    expect(() => {
      act(() => result.current.goTo("liveness"));
    }).toThrow('Invalid transition: "enrollment" → "liveness"');
  });

  it("canGoTo returns true for valid targets", () => {
    const { result } = renderHook(() => useVerificationStepper("method"));
    expect(result.current.canGoTo("document")).toBe(true);
    expect(result.current.canGoTo("passport-chip")).toBe(true);
  });

  it("canGoTo returns false for invalid targets", () => {
    const { result } = renderHook(() => useVerificationStepper("method"));
    expect(result.current.canGoTo("enrollment")).toBe(false);
    expect(result.current.canGoTo("liveness")).toBe(false);
  });

  it("tracks visited steps across transitions", () => {
    const { result } = renderHook(() => useVerificationStepper("enrollment"));
    act(() => result.current.goTo("method"));
    act(() => result.current.goTo("document"));
    act(() => result.current.goTo("liveness"));

    expect(result.current.visitedSteps).toEqual(
      new Set(["enrollment", "method", "document", "liveness"])
    );
  });

  it("handles branching: method → passport-chip (terminal)", () => {
    const { result } = renderHook(() => useVerificationStepper("method"));
    act(() => result.current.goTo("passport-chip"));

    expect(result.current.currentStep).toBe("passport-chip");
    expect(result.current.visitedSteps.has("document")).toBe(false);
    expect(result.current.visitedSteps.has("passport-chip")).toBe(true);
    expect(result.current.canGoTo("enrollment")).toBe(false);
  });

  it("reset returns to initial step and clears visited", () => {
    const { result } = renderHook(() => useVerificationStepper("enrollment"));
    act(() => result.current.goTo("method"));
    act(() => result.current.goTo("document"));
    act(() => result.current.reset());

    expect(result.current.currentStep).toBe("enrollment");
    expect(result.current.visitedSteps).toEqual(new Set(["enrollment"]));
  });

  it("terminal steps have no valid transitions", () => {
    const { result } = renderHook(() => useVerificationStepper("liveness"));

    expect(result.current.canGoTo("enrollment")).toBe(false);
    expect(result.current.canGoTo("method")).toBe(false);
    expect(result.current.canGoTo("document")).toBe(false);
  });
});
