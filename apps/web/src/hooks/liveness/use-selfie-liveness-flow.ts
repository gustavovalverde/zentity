/**
 * Selfie Liveness Flow Hook
 *
 * Manages the multi-gesture liveness detection flow on the client side.
 * Works with Human.js for real-time face detection and gesture recognition.
 *
 * @see ./types.ts for type definitions
 * @see ./constants.ts for configuration values
 */
"use client";

import type {
  ChallengeState,
  LivenessDebugFrame,
  LivenessSession,
  ServerProgress,
  UseSelfieLivenessFlowArgs,
} from "./types";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  CHALLENGE_INSTRUCTIONS,
  type ChallengeInfo,
  type ChallengeType,
  SMILE_DELTA_THRESHOLD,
  SMILE_HIGH_THRESHOLD,
  SMILE_SCORE_THRESHOLD,
  TURN_YAW_ABSOLUTE_THRESHOLD_DEG,
  TURN_YAW_SIGNIFICANT_DELTA_DEG,
} from "@/lib/liveness";
import {
  getFacingDirection,
  getGestureNames,
  getHappyScore,
  getPrimaryFace,
  getYawDegrees,
} from "@/lib/liveness/human-metrics";
import { trpc } from "@/lib/trpc/client";

import {
  CHALLENGE_PASSED_DELAY,
  CHALLENGE_PREP_DELAY,
  CHALLENGE_TIMEOUT,
  DETECTION_INTERVAL,
  FACE_TIMEOUT,
  FRAME_STREAM_INTERVAL,
  HEAD_CENTER_THRESHOLD,
  NUM_CHALLENGES,
  STABILITY_FRAMES,
  VERIFY_TIMEOUT,
} from "./constants";

// Re-export types for backward compatibility

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Hook for managing the multi-gesture liveness detection flow.
 *
 * @param args.videoRef - Reference to the video element for camera feed
 * @param args.human - Human.js instance for face detection
 * @param args.onVerified - Callback when liveness is verified successfully
 * @param args.onReset - Callback when flow is reset/retried
 */
export function useSelfieLivenessFlow(args: UseSelfieLivenessFlowArgs) {
  const {
    videoRef,
    isStreaming,
    startCamera,
    stopCamera,
    captureFrame,
    captureStreamFrame,
    getSquareDetectionCanvas,
    human,
    humanReady,
    livenessDebugEnabled,
    initialSelfieImage,
    onVerified,
    onReset,
    onSessionError,
  } = args;

  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [baselineImage, setBaselineImage] = useState<string | null>(null);
  const [challengeImage, setChallengeImage] = useState<string | null>(
    initialSelfieImage || null,
  );

  const [session, setSession] = useState<LivenessSession | null>(null);
  const [currentChallenge, setCurrentChallenge] =
    useState<ChallengeInfo | null>(null);
  const [completedChallenges, setCompletedChallenges] = useState<
    Array<{ type: ChallengeType; image: string; turnStartYaw?: number }>
  >([]);
  const [baselineHappyScore, setBaselineHappyScore] = useState(0);

  const [detectionProgress, setDetectionProgress] = useState(0);
  const [challengeProgress, setChallengeProgress] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timeoutMessage, setTimeoutMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [serverProgress, setServerProgress] = useState<ServerProgress | null>(
    null,
  );
  const [serverHint, setServerHint] = useState<string>("");

  const consecutiveDetectionsRef = useRef(0);
  const consecutiveChallengeDetectionsRef = useRef(0);
  const isCheckingRef = useRef(false);
  const isStreamingFrameRef = useRef(false);
  const headTurnCenteredRef = useRef(false);
  const headTurnStartYawRef = useRef(0);
  const lastHappyRef = useRef(0);

  // SSE and frame streaming refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const frameStreamingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugLastUpdateRef = useRef(0);
  const [debugFrame, setDebugFrame] = useState<LivenessDebugFrame | null>(null);
  const [lastVerifyError, setLastVerifyError] = useState<string>("");
  const [lastVerifyResponse, setLastVerifyResponse] = useState<unknown>(null);

  // Store last detection result for the separate rendering loop
  const lastDetectionResultRef = useRef<unknown>(null);
  const lastDetectionFaceRef = useRef<ReturnType<typeof getPrimaryFace>>(null);

  // Refs for values used in callbacks to avoid recreating callbacks on state changes
  const challengeStateRef = useRef(challengeState);
  const baselineHappyScoreRef = useRef(baselineHappyScore);

  // Keep refs in sync with state
  challengeStateRef.current = challengeState;
  baselineHappyScoreRef.current = baselineHappyScore;

  const buildChallengeInfo = useCallback(
    (
      challengeType: ChallengeType,
      index: number,
      total: number,
    ): ChallengeInfo => {
      return {
        challengeType,
        index,
        total,
        ...CHALLENGE_INSTRUCTIONS[challengeType],
      };
    },
    [],
  );

  const syncDebugCanvasSize = useCallback(() => {
    if (!livenessDebugEnabled) return;
    const video = videoRef.current;
    const canvas = debugCanvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    if (!width || !height) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }, [livenessDebugEnabled, videoRef]);

  const drawDebugOverlay = useCallback(
    (result: unknown) => {
      if (!livenessDebugEnabled) return;
      if (!human || !videoRef.current) return;
      const canvas = debugCanvasRef.current;
      if (!canvas) return;

      syncDebugCanvasSize();
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      try {
        const res = result as { face?: unknown[] } | null;
        const faces = res?.face ?? [];

        // Mirror coordinates to match the CSS-mirrored video display
        // The video has transform: -scale-x-100, so we need to flip x coords
        // biome-ignore lint/suspicious/noExplicitAny: Human.js FaceResult type requires type assertion
        const mirroredFaces = faces.map((face: any) => {
          if (!face?.box) return face;
          const [x, y, w, h] = face.box;
          // Mirror x coordinate: newX = canvasWidth - x - width
          const mirroredBox = [canvas.width - x - w, y, w, h];

          // Also mirror mesh points if present
          let mirroredMesh = face.mesh;
          if (face.mesh && Array.isArray(face.mesh)) {
            mirroredMesh = face.mesh.map(
              (point: [number, number, number] | number[]) => {
                if (Array.isArray(point) && point.length >= 2) {
                  return [canvas.width - point[0], point[1], point[2] ?? 0];
                }
                return point;
              },
            );
          }

          return {
            ...face,
            box: mirroredBox,
            mesh: mirroredMesh,
          };
        });

        human.draw?.face?.(
          canvas,
          // biome-ignore lint/suspicious/noExplicitAny: Human.js draw API requires their specific FaceResult type
          mirroredFaces as any,
          {
            drawBoxes: true,
            drawLabels: true,
            drawPolygons: true,
            drawPoints: false,
            drawGaze: false,
            drawAttention: false,
          },
        );
      } catch {
        // ignore draw errors in debug mode
      }
    },
    [livenessDebugEnabled, human, syncDebugCanvasSize, videoRef],
  );

  const updateDebug = useCallback(
    (result: unknown, face: ReturnType<typeof getPrimaryFace>) => {
      if (!livenessDebugEnabled) return;

      const now = performance.now();
      if (now - debugLastUpdateRef.current < 250) return;
      debugLastUpdateRef.current = now;

      const video = videoRef.current;
      const gestureNames = getGestureNames(result);
      const happy = getHappyScore(face);
      // Read from refs for current values (avoids callback recreation)
      const currentBaselineHappy = baselineHappyScoreRef.current;

      // Extract performance metrics from Human.js result
      const perfData = (result as { performance?: Record<string, number> })
        ?.performance;

      setDebugFrame({
        ts: Date.now(),
        state: challengeStateRef.current,
        faceDetected: Boolean(face),
        happy,
        baselineHappy: currentBaselineHappy,
        deltaHappy: happy - currentBaselineHappy,
        yawDeg: face ? getYawDegrees(face) : 0,
        dir: face
          ? getFacingDirection(result, face, HEAD_CENTER_THRESHOLD)
          : "center",
        headTurnCentered: headTurnCenteredRef.current,
        consecutiveDetections: consecutiveDetectionsRef.current,
        consecutiveChallengeDetections:
          consecutiveChallengeDetectionsRef.current,
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        gesture: gestureNames,
        performance: perfData
          ? {
              detect: perfData.detect,
              total: perfData.total,
            }
          : undefined,
      });
    },
    [livenessDebugEnabled, videoRef],
  );

  useEffect(() => {
    if (!livenessDebugEnabled) return;
    const video = videoRef.current;
    if (!video) return;
    const handle = () => syncDebugCanvasSize();
    video.addEventListener("loadedmetadata", handle);
    handle();
    return () => video.removeEventListener("loadedmetadata", handle);
  }, [livenessDebugEnabled, syncDebugCanvasSize, videoRef]);

  useEffect(() => {
    if (!livenessDebugEnabled) return;
    const canvas = debugCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!isStreaming) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [livenessDebugEnabled, isStreaming]);

  const beginCamera = useCallback(async () => {
    setChallengeState("loading_session");
    try {
      const newSession = (await trpc.liveness.createSession.mutate({
        numChallenges: NUM_CHALLENGES,
      })) as {
        sessionId: string;
        challenges: ChallengeType[];
        currentChallenge: ChallengeInfo | null;
      };
      setSession({
        sessionId: newSession.sessionId,
        challenges: newSession.challenges,
      });
      setCurrentChallenge(newSession.currentChallenge);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Please try again";

      // Check if this is a session error (FORBIDDEN = session expired)
      if (
        errorMsg.includes("onboarding session") ||
        errorMsg.includes("start from the beginning")
      ) {
        toast.info("Session expired. Starting fresh...");
        setChallengeState("idle");
        onSessionError?.();
        return;
      }

      toast.error("Failed to create challenge session", {
        description: errorMsg,
      });
      setChallengeState("idle");
      return;
    }

    try {
      await startCamera();
      setChallengeState("detecting");
      setStatusMessage("Position your face in the frame");
    } catch {
      toast.error("Camera access denied", {
        description:
          "Unable to access camera. Please check permissions and try again.",
      });
      setChallengeState("idle");
    }
  }, [startCamera, onSessionError]);

  const checkForFace = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      // Use square-padded canvas if available (improves face detection accuracy)
      // Falls back to video element if not available
      const detectionInput = getSquareDetectionCanvas?.() ?? videoRef.current;
      // Use raw detection for decision making (no temporal smoothing)
      const result = await human.detect(detectionInput);
      const face = getPrimaryFace(result);

      // Store result for the separate rendering loop
      lastDetectionResultRef.current = result;
      lastDetectionFaceRef.current = face ?? null;

      if (face) {
        const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
        lastHappyRef.current = getHappyScore(face);

        if (dir === "center") {
          consecutiveDetectionsRef.current++;
          setDetectionProgress(
            (consecutiveDetectionsRef.current / STABILITY_FRAMES) * 100,
          );
          if (consecutiveDetectionsRef.current >= STABILITY_FRAMES) {
            setChallengeState("countdown");
            consecutiveDetectionsRef.current = 0;
          }
        } else {
          consecutiveDetectionsRef.current = 0;
          setDetectionProgress(0);
          setStatusMessage("Center your face in the frame");
        }
      } else {
        consecutiveDetectionsRef.current = 0;
        setDetectionProgress(0);
        setStatusMessage("Position your face in the frame");
      }
    } catch {
      // ignore per-frame errors
    } finally {
      isCheckingRef.current = false;
    }
  }, [human, humanReady, videoRef, getSquareDetectionCanvas]);

  const handleCapturedChallenge = useCallback(
    async (
      challengeType: ChallengeType,
      image: string,
      turnStartYaw?: number,
    ) => {
      if (!session || !baselineImage) return;

      const newCompleted = [
        ...completedChallenges,
        { type: challengeType, image, turnStartYaw },
      ];
      setCompletedChallenges(newCompleted);
      setChallengeImage(image);

      const nextIndex = (currentChallenge?.index ?? 0) + 1;
      if (nextIndex < session.challenges.length) {
        setChallengeState("challenge_passed");
        setTimeout(() => {
          const nextType = session.challenges[nextIndex];
          setCurrentChallenge(
            buildChallengeInfo(nextType, nextIndex, session.challenges.length),
          );
          setChallengeProgress(0);
          consecutiveChallengeDetectionsRef.current = 0;
          headTurnCenteredRef.current = false;
          headTurnStartYawRef.current = 0;
          setChallengeState("preparing_challenge");
          setTimeout(() => {
            setChallengeState("waiting_challenge");
          }, CHALLENGE_PREP_DELAY);
        }, CHALLENGE_PASSED_DELAY);
        return;
      }

      setChallengeState("validating");
      // Immediately stop background server frame streaming + SSE to avoid
      // concurrent server-side detection while verify runs (can cause hangs).
      if (frameStreamingRef.current) {
        clearInterval(frameStreamingRef.current);
        frameStreamingRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      try {
        const data = (await withTimeout(
          trpc.liveness.verify.mutate({
            sessionId: session.sessionId,
            baselineImage,
            challenges: newCompleted.map((c) => ({
              challengeType: c.type,
              image: c.image,
              turnStartYaw: c.turnStartYaw,
            })),
            debug: livenessDebugEnabled,
          }),
          VERIFY_TIMEOUT,
          "Verification is taking too long. Please try again.",
        )) as {
          verified?: boolean;
          error?: string;
        } | null;

        if (!data) {
          throw new Error("Liveness verification failed (invalid response)");
        }

        setLastVerifyResponse(data);
        if (!data.verified) {
          const message = data.error || "Liveness verification failed";
          setLastVerifyError(message);
          throw new Error(message);
        }

        setLastVerifyError("");
        setChallengeState("all_passed");
        stopCamera();
        onVerified({
          selfieImage: baselineImage,
          bestSelfieFrame: baselineImage,
          blinkCount: null,
        });
      } catch (err) {
        if (livenessDebugEnabled) {
          // biome-ignore lint/suspicious/noConsole: debug-only liveness diagnostics
          console.warn("Liveness verify failed", { err, lastVerifyResponse });
        }
        setChallengeState("failed");
        toast.error("Verification failed", {
          description: err instanceof Error ? err.message : "Please try again.",
        });
        stopCamera();
      }
    },
    [
      session,
      baselineImage,
      completedChallenges,
      currentChallenge,
      livenessDebugEnabled,
      buildChallengeInfo,
      stopCamera,
      onVerified,
      lastVerifyResponse,
    ],
  );

  const checkCurrentChallenge = useCallback(async () => {
    if (!human || !humanReady || !videoRef.current || !currentChallenge) return;
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    try {
      const frameDataUrl = captureFrame();
      if (!frameDataUrl) return;

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = frameDataUrl;
      });

      // Use raw detection for decision making (no temporal smoothing)
      const result = await human.detect(img);
      const face = getPrimaryFace(result);

      // Store result for the separate rendering loop
      lastDetectionResultRef.current = result;
      lastDetectionFaceRef.current = face ?? null;

      if (!face) {
        setChallengeState("detecting");
        setStatusMessage("Face lost - position your face in the frame");
        consecutiveChallengeDetectionsRef.current = 0;
        headTurnCenteredRef.current = false;
        headTurnStartYawRef.current = 0;
        return;
      }

      const type = currentChallenge.challengeType;
      const happy = getHappyScore(face);
      lastHappyRef.current = happy;
      const dir = getFacingDirection(result, face, HEAD_CENTER_THRESHOLD);
      const yaw = getYawDegrees(face);

      if (type === "smile") {
        const happyPct = Math.round(happy * 100);
        setChallengeProgress(happyPct);
        const delta = happy - baselineHappyScore;
        const smilePassed =
          (happy >= SMILE_SCORE_THRESHOLD && delta >= SMILE_DELTA_THRESHOLD) ||
          happy >= SMILE_HIGH_THRESHOLD;
        if (smilePassed) {
          consecutiveChallengeDetectionsRef.current++;
          if (consecutiveChallengeDetectionsRef.current >= STABILITY_FRAMES) {
            consecutiveChallengeDetectionsRef.current = 0;
            setChallengeState("capturing");
            // IMPORTANT: Capture a FRESH frame right now, not the stale one from start of check
            // This ensures the submitted image matches the detected smile
            const freshFrame = captureFrame();
            if (freshFrame) {
              await handleCapturedChallenge("smile", freshFrame);
            } else {
              setChallengeState("waiting_challenge");
            }
          }
        } else {
          consecutiveChallengeDetectionsRef.current = 0;
        }
      } else if (type === "turn_left" || type === "turn_right") {
        const yawProgress = Math.min(
          (Math.abs(yaw) / TURN_YAW_ABSOLUTE_THRESHOLD_DEG) * 100,
          100,
        );
        setChallengeProgress(yawProgress);

        if (!headTurnCenteredRef.current) {
          if (dir === "center") {
            headTurnCenteredRef.current = true;
            headTurnStartYawRef.current = yaw;
            setStatusMessage("");
          } else {
            setStatusMessage("Center your head to start the turn");
            return;
          }
        }

        const wantsLeft = type === "turn_left";
        const yawDelta = Math.abs(yaw - headTurnStartYawRef.current);
        const absolutePass = wantsLeft
          ? yaw < -TURN_YAW_ABSOLUTE_THRESHOLD_DEG
          : yaw > TURN_YAW_ABSOLUTE_THRESHOLD_DEG;
        const deltaPass = yawDelta >= TURN_YAW_SIGNIFICANT_DELTA_DEG;
        const correctDirection = wantsLeft
          ? yaw < headTurnStartYawRef.current
          : yaw > headTurnStartYawRef.current;
        const passed = correctDirection && (absolutePass || deltaPass);
        if (passed) {
          consecutiveChallengeDetectionsRef.current++;
          setStatusMessage("Hold the turn…");
          if (consecutiveChallengeDetectionsRef.current >= STABILITY_FRAMES) {
            consecutiveChallengeDetectionsRef.current = 0;
            setStatusMessage("");
            setChallengeState("capturing");
            // IMPORTANT: Capture a FRESH frame right now, not the stale one from start of check
            // This ensures the submitted image matches the detected turn
            const freshFrame = captureFrame();
            if (freshFrame) {
              // Pass the turn start yaw so server can validate delta from same baseline
              await handleCapturedChallenge(
                type,
                freshFrame,
                headTurnStartYawRef.current,
              );
            } else {
              setChallengeState("waiting_challenge");
            }
          }
        } else {
          consecutiveChallengeDetectionsRef.current = 0;
        }
      }
    } catch {
      // ignore per-frame errors
    } finally {
      isCheckingRef.current = false;
    }
  }, [
    human,
    humanReady,
    videoRef,
    currentChallenge,
    baselineHappyScore,
    captureFrame,
    handleCapturedChallenge,
  ]);

  // Countdown effect for baseline capture
  useEffect(() => {
    if (challengeState !== "countdown") return;

    let count = 3;
    setCountdown(count);

    const interval = setInterval(() => {
      count--;
      setCountdown(count);

      if (count === 0) {
        clearInterval(interval);
        const baseline = captureFrame();
        if (baseline) {
          setBaselineImage(baseline);
          setBaselineHappyScore(lastHappyRef.current);
          setChallengeState("waiting_challenge");
          setChallengeProgress(0);
          setStatusMessage("");
          consecutiveChallengeDetectionsRef.current = 0;
        } else {
          setChallengeState("detecting");
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [challengeState, captureFrame]);

  // Main detection loop
  useEffect(() => {
    if (!isStreaming) return;
    if (
      challengeState !== "detecting" &&
      challengeState !== "waiting_challenge"
    ) {
      return;
    }

    let lastCheck = 0;
    let animationId: number;

    const detectLoop = (timestamp: number) => {
      if (timestamp - lastCheck < DETECTION_INTERVAL) {
        animationId = requestAnimationFrame(detectLoop);
        return;
      }
      lastCheck = timestamp;

      if (challengeState === "detecting") {
        void checkForFace();
      } else if (challengeState === "waiting_challenge") {
        void checkCurrentChallenge();
      }

      animationId = requestAnimationFrame(detectLoop);
    };

    animationId = requestAnimationFrame(detectLoop);
    return () => cancelAnimationFrame(animationId);
  }, [isStreaming, challengeState, checkForFace, checkCurrentChallenge]);

  // Separate rendering loop for smooth debug overlay (60fps)
  // Uses human.next() for temporal smoothing between detections
  useEffect(() => {
    if (!livenessDebugEnabled || !isStreaming || !human) return;
    if (
      challengeState !== "detecting" &&
      challengeState !== "waiting_challenge"
    ) {
      return;
    }

    let animationId: number;

    const renderLoop = () => {
      // Use human.next() for temporally smoothed/interpolated results
      // This provides smoother visual feedback without affecting detection accuracy
      const smoothedResult = human.next?.() ?? lastDetectionResultRef.current;
      const result = smoothedResult || lastDetectionResultRef.current;

      if (result) {
        drawDebugOverlay(result);
        updateDebug(result, lastDetectionFaceRef.current);
      }

      animationId = requestAnimationFrame(renderLoop);
    };

    animationId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationId);
  }, [
    livenessDebugEnabled,
    isStreaming,
    human,
    challengeState,
    drawDebugOverlay,
    updateDebug,
  ]);

  // Face detection timeout
  useEffect(() => {
    if (challengeState !== "detecting") return;

    const timeout = setTimeout(() => {
      setChallengeState("timeout");
      setTimeoutMessage("Could not detect your face. Please try again.");
      stopCamera();
    }, FACE_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [challengeState, stopCamera]);

  // Challenge detection timeout
  useEffect(() => {
    if (challengeState !== "waiting_challenge") return;

    const timeout = setTimeout(() => {
      setChallengeState("timeout");
      const challengeName = currentChallenge?.title || "Challenge";
      setTimeoutMessage(
        `${challengeName} not detected in time. Please try again.`,
      );
      stopCamera();
    }, CHALLENGE_TIMEOUT);

    return () => clearTimeout(timeout);
  }, [challengeState, currentChallenge, stopCamera]);

  // Toast notifications for status changes
  useEffect(() => {
    if (challengeState === "all_passed") {
      toast.success("Liveness verified!", {
        description: `All ${completedChallenges.length} challenges completed successfully!`,
      });
    }
  }, [challengeState, completedChallenges.length]);

  useEffect(() => {
    if (challengeState === "challenge_passed" && currentChallenge) {
      toast.success(`${currentChallenge.title} passed!`, {
        description: "Moving to next challenge...",
        duration: CHALLENGE_PASSED_DELAY,
      });
    }
  }, [challengeState, currentChallenge]);

  useEffect(() => {
    if (challengeState === "timeout") {
      toast.error("Timeout", {
        description: timeoutMessage || "Please try again.",
      });
    }
  }, [challengeState, timeoutMessage]);

  // SSE connection for real-time server feedback
  useEffect(() => {
    if (!session?.sessionId) return;

    // Connect to SSE stream
    const eventSource = new EventSource(
      `/api/liveness/stream?sessionId=${session.sessionId}`,
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "progress") {
          setServerProgress({
            faceDetected: data.faceDetected,
            progress: data.progress,
            passed: data.passed,
            hint: data.hint,
            happy: data.happy,
            yaw: data.yaw,
            direction: data.direction,
          });
          if (data.hint) {
            setServerHint(data.hint);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      // SSE connection lost, will auto-reconnect
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [session?.sessionId]);

  // Frame streaming during challenges (for server-side hints)
  useEffect(() => {
    if (challengeState !== "waiting_challenge" || !session?.sessionId) {
      // Clean up streaming when not in challenge state
      if (frameStreamingRef.current) {
        clearInterval(frameStreamingRef.current);
        frameStreamingRef.current = null;
      }
      isStreamingFrameRef.current = false;
      return;
    }

    const streamFrame = async () => {
      if (isStreamingFrameRef.current) return;
      // Use optimized stream frame capture if available, otherwise fall back to regular
      const captureForStream = captureStreamFrame ?? captureFrame;
      const frame = captureForStream();
      if (!frame || !currentChallenge) return;

      isStreamingFrameRef.current = true;
      try {
        await fetch("/api/liveness/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            challengeType: currentChallenge.challengeType,
            frameData: frame,
            baselineHappy: baselineHappyScore,
            turnStartYaw: headTurnStartYawRef.current || undefined,
          }),
        });
      } catch {
        // Ignore frame streaming errors
      } finally {
        isStreamingFrameRef.current = false;
      }
    };

    // Stream frames at a limited rate and avoid overlapping requests.
    frameStreamingRef.current = setInterval(
      () => void streamFrame(),
      FRAME_STREAM_INTERVAL,
    );

    return () => {
      if (frameStreamingRef.current) {
        clearInterval(frameStreamingRef.current);
        frameStreamingRef.current = null;
      }
      isStreamingFrameRef.current = false;
    };
  }, [
    challengeState,
    session?.sessionId,
    currentChallenge,
    captureFrame,
    captureStreamFrame,
    baselineHappyScore,
  ]);

  const retryChallenge = useCallback(() => {
    // Clean up SSE connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (frameStreamingRef.current) {
      clearInterval(frameStreamingRef.current);
      frameStreamingRef.current = null;
    }

    setBaselineImage(null);
    setChallengeImage(null);
    setChallengeState("idle");
    setDetectionProgress(0);
    setChallengeProgress(0);
    setTimeoutMessage("");
    setStatusMessage("");
    setServerProgress(null);
    setServerHint("");
    setBaselineHappyScore(0);
    setSession(null);
    setCurrentChallenge(null);
    setCompletedChallenges([]);
    consecutiveDetectionsRef.current = 0;
    consecutiveChallengeDetectionsRef.current = 0;
    headTurnCenteredRef.current = false;
    headTurnStartYawRef.current = 0;
    isStreamingFrameRef.current = false;
    onReset();
    void beginCamera();
  }, [beginCamera, onReset]);

  return {
    challengeState,
    baselineImage,
    challengeImage,
    session,
    currentChallenge,
    completedChallenges,
    detectionProgress,
    challengeProgress,
    countdown,
    timeoutMessage,
    statusMessage,
    serverProgress,
    serverHint,
    debugCanvasRef,
    debugFrame,
    lastVerifyError,
    lastVerifyResponse,
    livenessDebugEnabled,
    beginCamera,
    retryChallenge,
  };
}
