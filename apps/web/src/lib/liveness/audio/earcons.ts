/**
 * Earcon configurations for liveness feedback audio.
 * These are programmatically generated using the Web Audio API for:
 * - Zero file size overhead
 * - Consistent playback across devices
 * - Privacy (no external API calls)
 */

export interface EarconEnvelope {
  attack: number; // Attack time in ms
  decay: number; // Decay time in ms
  sustain: number; // Sustain level (0-1)
  release: number; // Release time in ms
}

export interface EarconConfig {
  frequencies: number[]; // Hz values for the tones
  duration: number; // Total duration in ms
  type: OscillatorType; // 'sine' | 'square' | 'sawtooth' | 'triangle'
  envelope: EarconEnvelope;
  volume?: number; // Optional volume multiplier (0-1), defaults to 0.7
}

export type EarconType =
  | "faceDetected"
  | "faceLost"
  | "challengeProgress"
  | "challengePassed"
  | "verificationComplete"
  | "error"
  | "countdown"
  | "countdown3"
  | "countdown2"
  | "countdown1";

/**
 * Earcon definitions for each feedback event.
 *
 * Musical design principles:
 * - Ascending tones = positive feedback (detected, success)
 * - Descending tones = negative feedback (lost, error)
 * - Major intervals = success (C-E-G)
 * - Minor intervals = warning/error
 * - Short duration = non-intrusive
 */
export const EARCONS: Record<EarconType, EarconConfig> = {
  /**
   * Face detected - ascending perfect fifth (A4 → E5)
   * Pleasant, confirming sound when face enters frame
   */
  faceDetected: {
    frequencies: [440, 660], // A4 → E5
    duration: 200,
    type: "sine",
    envelope: { attack: 10, decay: 50, sustain: 0.6, release: 100 },
    volume: 0.6,
  },

  /**
   * Face lost - descending minor third (E4 → C#4)
   * Warning sound, slightly unsettling but not alarming
   */
  faceLost: {
    frequencies: [330, 277], // E4 → C#4
    duration: 150,
    type: "triangle",
    envelope: { attack: 5, decay: 30, sustain: 0.5, release: 80 },
    volume: 0.5,
  },

  /**
   * Challenge progress - single tick (C5)
   * Subtle feedback for reaching milestones (50%, etc.)
   */
  challengeProgress: {
    frequencies: [523], // C5
    duration: 80,
    type: "sine",
    envelope: { attack: 5, decay: 20, sustain: 0.3, release: 40 },
    volume: 0.4,
  },

  /**
   * Challenge passed - major arpeggio (C5 → E5 → G5)
   * Satisfying success sound for completing a challenge
   */
  challengePassed: {
    frequencies: [523, 659, 784], // C5 → E5 → G5 (C major)
    duration: 300,
    type: "sine",
    envelope: { attack: 10, decay: 40, sustain: 0.7, release: 100 },
    volume: 0.7,
  },

  /**
   * Verification complete - full octave arpeggio (C5 → E5 → G5 → C6)
   * Celebratory fanfare for completing the entire flow
   */
  verificationComplete: {
    frequencies: [523, 659, 784, 1047], // C5 → E5 → G5 → C6
    duration: 500,
    type: "sine",
    envelope: { attack: 20, decay: 60, sustain: 0.8, release: 150 },
    volume: 0.8,
  },

  /**
   * Error - descending minor second (A3 → G#3)
   * Distinct warning sound for failures
   */
  error: {
    frequencies: [220, 208], // A3 → G#3 (minor second)
    duration: 300,
    type: "square",
    envelope: { attack: 5, decay: 50, sustain: 0.4, release: 150 },
    volume: 0.5,
  },

  /**
   * Countdown tick - single beep (G5)
   * Used for 3, 2, 1 countdown
   */
  countdown: {
    frequencies: [784], // G5
    duration: 100,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 50 },
    volume: 0.5,
  },

  /**
   * Countdown 3 - high beep (A5)
   */
  countdown3: {
    frequencies: [880], // A5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },

  /**
   * Countdown 2 - mid beep (G5)
   */
  countdown2: {
    frequencies: [784], // G5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },

  /**
   * Countdown 1 - lower beep (E5)
   */
  countdown1: {
    frequencies: [659], // E5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },
};
