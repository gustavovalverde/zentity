/**
 * Unified feedback controller for liveness detection.
 * Combines audio (earcons), speech (TTS), and haptic feedback.
 *
 * Privacy: All feedback is generated locally in the browser.
 * - Audio: Web Audio API (programmatic synthesis)
 * - Speech: Web Speech API (device's built-in TTS)
 * - Haptics: Vibration API
 *
 * No data is sent to external services.
 */

"use client";

import type { SpeechKey, SupportedLanguage } from "@/lib/liveness/speech/texts";

import { useCallback, useEffect, useRef, useState } from "react";

import { EARCONS, type EarconType } from "@/lib/liveness/audio/earcons";
import { audioEngine } from "@/lib/liveness/audio/engine";
import {
  HAPTIC_PATTERNS,
  type HapticType,
  isHapticsSupported,
  vibrate,
} from "@/lib/liveness/haptics/patterns";
import { speechEngine } from "@/lib/liveness/speech/engine";

export type FeedbackType = EarconType;

interface FeedbackOptions {
  /** Enable/disable earcon audio. Default: true */
  audioEnabled?: boolean;
  /** Enable/disable TTS speech. Default: true */
  speechEnabled?: boolean;
  /** Enable/disable haptic vibration. Default: true */
  hapticEnabled?: boolean;
  /** Language for TTS. Default: auto-detected */
  language?: SupportedLanguage;
}

interface FeedbackController {
  // Unified feedback trigger with optional stereo pan (-1 = left, 0 = center, 1 = right)
  feedback: (type: FeedbackType, pan?: number) => void;

  // Individual feedback methods
  playEarcon: (type: EarconType, pan?: number) => void;
  speak: (key: SpeechKey, priority?: "low" | "high") => Promise<void>;
  speakText: (text: string, priority?: "low" | "high") => Promise<void>;
  triggerHaptic: (type: HapticType) => void;
  cancelSpeech: () => void;

  // State controls
  setAudioEnabled: (enabled: boolean) => void;
  setSpeechEnabled: (enabled: boolean) => void;
  setHapticEnabled: (enabled: boolean) => void;

  // State getters
  audioEnabled: boolean;
  speechEnabled: boolean;
  hapticEnabled: boolean;
  isSpeaking: boolean;

  // Support checks
  audioSupported: boolean;
  speechSupported: boolean;
  hapticSupported: boolean;

  // Initialize audio/speech (must be called from user interaction)
  initAudio: () => void;
  initSpeech: () => void;
}

const STORAGE_KEY = "zentity-liveness-feedback-prefs";

interface StoredPrefs {
  audioEnabled: boolean;
  speechEnabled: boolean;
  hapticEnabled: boolean;
}

function loadPrefs(): StoredPrefs | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as StoredPrefs;
    }
  } catch {
    // Ignore localStorage errors
  }
  return null;
}

function savePrefs(prefs: StoredPrefs): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Hook for managing liveness detection feedback.
 *
 * @example
 * ```tsx
 * const { feedback, speak, initAudio, setAudioEnabled, audioEnabled } = useLivenessFeedback();
 *
 * // Initialize audio on user interaction
 * <button onClick={() => { initAudio(); startLiveness(); }}>Start</button>
 *
 * // Trigger feedback
 * feedback('faceDetected');
 *
 * // Speak instruction
 * speak('smile');
 *
 * // Toggle audio
 * <button onClick={() => setAudioEnabled(!audioEnabled)}>
 *   {audioEnabled ? 'Mute' : 'Unmute'}
 * </button>
 * ```
 */
export function useLivenessFeedback(
  options: FeedbackOptions = {}
): FeedbackController {
  // Load persisted preferences or use defaults (all enabled)
  const storedPrefs = useRef(loadPrefs());

  const [audioEnabled, setAudioEnabledState] = useState(
    options.audioEnabled ?? storedPrefs.current?.audioEnabled ?? true
  );
  const [speechEnabled, setSpeechEnabledState] = useState(
    options.speechEnabled ?? storedPrefs.current?.speechEnabled ?? true
  );
  const [hapticEnabled, setHapticEnabledState] = useState(
    options.hapticEnabled ?? storedPrefs.current?.hapticEnabled ?? true
  );
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Support checks
  const audioSupported = audioEngine.isSupported();
  const speechSupported = speechEngine.isSupported();
  const hapticSupported = isHapticsSupported();

  // Set language if provided
  useEffect(() => {
    if (options.language) {
      speechEngine.setLanguage(options.language);
    }
  }, [options.language]);

  // Wire speech engine reference to audio engine for coordination
  useEffect(() => {
    audioEngine.setSpeechEngineRef(speechEngine);
    return () => {
      audioEngine.setSpeechEngineRef(null);
      audioEngine.resetDebounce();
    };
  }, []);

  // Sync engine states with hook state (only when changed)
  useEffect(() => {
    audioEngine.setEnabled(audioEnabled);
  }, [audioEnabled]);

  useEffect(() => {
    speechEngine.setEnabled(speechEnabled);
  }, [speechEnabled]);

  // Persist preferences
  useEffect(() => {
    savePrefs({ audioEnabled, speechEnabled, hapticEnabled });
  }, [audioEnabled, speechEnabled, hapticEnabled]);

  // Initialize audio context (must be from user interaction)
  const initAudio = useCallback(() => {
    audioEngine.init();
  }, []);

  // Initialize speech synthesis (must be from user interaction)
  const initSpeech = useCallback(() => {
    speechEngine.init();
  }, []);

  // Play earcon with optional stereo panning
  const playEarcon = useCallback(
    (type: EarconType, pan = 0) => {
      if (audioEnabled && audioSupported) {
        const config = EARCONS[type];
        audioEngine.playEarcon(config, type, pan);
      }
    },
    [audioEnabled, audioSupported]
  );

  // Speak by key (fire-and-forget: errors are caught internally)
  const speak = useCallback(
    async (key: SpeechKey, priority: "low" | "high" = "low") => {
      if (!(speechEnabled && speechSupported)) {
        return;
      }

      setIsSpeaking(true);
      try {
        await speechEngine.speakKey(key, { priority });
      } catch {
        // Speech synthesis failed (audio-busy, not-allowed, etc.)
        // This is non-critical - visual cues remain available
      } finally {
        setIsSpeaking(false);
      }
    },
    [speechEnabled, speechSupported]
  );

  // Speak custom text (fire-and-forget: errors are caught internally)
  const speakText = useCallback(
    async (text: string, priority: "low" | "high" = "low") => {
      if (!(speechEnabled && speechSupported)) {
        return;
      }

      setIsSpeaking(true);
      try {
        await speechEngine.speak(text, { priority });
      } catch {
        // Speech synthesis failed (audio-busy, not-allowed, etc.)
        // This is non-critical - visual cues remain available
      } finally {
        setIsSpeaking(false);
      }
    },
    [speechEnabled, speechSupported]
  );

  // Trigger haptic
  const triggerHaptic = useCallback(
    (type: HapticType) => {
      if (hapticEnabled && hapticSupported) {
        const pattern = HAPTIC_PATTERNS[type];
        if (pattern) {
          vibrate(pattern);
        }
      }
    },
    [hapticEnabled, hapticSupported]
  );

  // Cancel speech
  const cancelSpeech = useCallback(() => {
    speechEngine.cancel();
    setIsSpeaking(false);
  }, []);

  // Unified feedback trigger (earcon + haptic) with optional stereo pan
  const feedback = useCallback(
    (type: FeedbackType, pan = 0) => {
      playEarcon(type, pan);
      triggerHaptic(type as HapticType);
    },
    [playEarcon, triggerHaptic]
  );

  // State setters with persistence
  const setAudioEnabled = useCallback((enabled: boolean) => {
    setAudioEnabledState(enabled);
  }, []);

  const setSpeechEnabled = useCallback((enabled: boolean) => {
    setSpeechEnabledState(enabled);
    if (!enabled) {
      speechEngine.cancel();
    }
  }, []);

  const setHapticEnabled = useCallback((enabled: boolean) => {
    setHapticEnabledState(enabled);
  }, []);

  return {
    feedback,
    playEarcon,
    speak,
    speakText,
    triggerHaptic,
    cancelSpeech,
    setAudioEnabled,
    setSpeechEnabled,
    setHapticEnabled,
    audioEnabled,
    speechEnabled,
    hapticEnabled,
    isSpeaking,
    audioSupported,
    speechSupported,
    hapticSupported,
    initAudio,
    initSpeech,
  };
}
