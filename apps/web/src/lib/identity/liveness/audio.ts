/**
 * Liveness feedback audio.
 *
 * - Earcon configurations (programmatically generated via Web Audio API)
 * - Singleton engine that plays them with debouncing + speech-aware skip
 *
 * Privacy: audio is generated locally in the browser, no external API calls.
 */

// ---------------------------------------------------------------------------
// Earcon configurations
// ---------------------------------------------------------------------------

interface EarconEnvelope {
  attack: number; // Attack time in ms
  decay: number; // Decay time in ms
  release: number; // Release time in ms
  sustain: number; // Sustain level (0-1)
}

interface EarconConfig {
  duration: number; // Total duration in ms
  envelope: EarconEnvelope;
  frequencies: number[]; // Hz values for the tones
  type: OscillatorType; // 'sine' | 'square' | 'sawtooth' | 'triangle'
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

  /** Countdown 3 - high beep (A5) */
  countdown3: {
    frequencies: [880], // A5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },

  /** Countdown 2 - mid beep (G5) */
  countdown2: {
    frequencies: [784], // G5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },

  /** Countdown 1 - lower beep (E5) */
  countdown1: {
    frequencies: [659], // E5
    duration: 120,
    type: "sine",
    envelope: { attack: 5, decay: 30, sustain: 0.4, release: 60 },
    volume: 0.55,
  },
};

// ---------------------------------------------------------------------------
// Audio engine (singleton)
// ---------------------------------------------------------------------------

/** Debounce intervals per earcon type (ms) */
const DEBOUNCE_MS: Partial<Record<EarconType, number>> = {
  faceDetected: 1000, // Once per second max
  faceLost: 1500, // 1.5s between face lost sounds
  challengeProgress: 500, // 500ms between progress ticks
  error: 2000, // 2s between error sounds
  // challengePassed, verificationComplete, countdown: no debounce (0)
};

/** Earcons to skip when speech is playing (non-critical) */
const SKIP_DURING_SPEECH = new Set<EarconType>([
  "countdown",
  "countdown3",
  "countdown2",
  "countdown1",
  "challengeProgress",
  "faceDetected",
  "faceLost",
]);

class LivenessAudioEngine {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stereoPanner: StereoPannerNode | null = null;
  private enabled = true;
  private initialized = false;
  private readonly lastPlayTimes: Map<EarconType, number> = new Map();
  private speechEngineRef: { isSpeaking: () => boolean } | null = null;

  /**
   * Initialize the audio context.
   * Must be called from a user interaction event due to browser autoplay policies.
   */
  init(): boolean {
    if (globalThis.window === undefined) {
      return false;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = this.enabled ? 1 : 0;
        this.masterGain.connect(this.audioContext.destination);

        this.stereoPanner = this.audioContext.createStereoPanner();
        this.stereoPanner.connect(this.masterGain);
      }

      if (this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }

      this.initialized = true;
      return true;
    } catch {
      console.warn("Failed to initialize audio context");
      return false;
    }
  }

  /**
   * Set reference to speech engine for audio coordination.
   * When set, non-critical earcons will be skipped during speech.
   */
  setSpeechEngineRef(ref: { isSpeaking: () => boolean } | null): void {
    this.speechEngineRef = ref;
  }

  /**
   * Play an earcon sound effect with optional stereo panning.
   * @param config - Earcon configuration (frequencies, envelope, etc.)
   * @param earconType - Type of earcon for debouncing
   * @param pan - Stereo pan value: -1 = full left, 0 = center, 1 = full right
   */
  playEarcon(config: EarconConfig, earconType?: EarconType, pan = 0): void {
    if (!this.enabled) {
      return;
    }

    if (
      earconType &&
      SKIP_DURING_SPEECH.has(earconType) &&
      this.speechEngineRef?.isSpeaking()
    ) {
      return;
    }

    if (earconType) {
      const now = Date.now();
      const lastPlay = this.lastPlayTimes.get(earconType) ?? 0;
      const debounce = DEBOUNCE_MS[earconType] ?? 0;

      if (debounce > 0 && now - lastPlay < debounce) {
        return;
      }

      this.lastPlayTimes.set(earconType, now);
    }

    if (!this.initialized) {
      this.init();
    }

    if (!(this.audioContext && this.masterGain)) {
      return;
    }

    const { frequencies, duration, type, envelope, volume = 0.7 } = config;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const noteDuration = duration / frequencies.length / 1000;

    if (this.stereoPanner && pan !== 0) {
      this.stereoPanner.pan.setValueAtTime(pan, now);
    }

    for (const [index, freq] of frequencies.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.value = freq;

      const noteStart = now + index * noteDuration;
      const attackEnd = noteStart + envelope.attack / 1000;
      const decayEnd = attackEnd + envelope.decay / 1000;
      const noteEnd = noteStart + noteDuration;

      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(volume, attackEnd);
      gain.gain.linearRampToValueAtTime(envelope.sustain * volume, decayEnd);
      gain.gain.setValueAtTime(
        envelope.sustain * volume,
        noteEnd - envelope.release / 1000
      );
      gain.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(gain);

      if (pan !== 0 && this.stereoPanner) {
        gain.connect(this.stereoPanner);
      } else {
        gain.connect(this.masterGain);
      }

      osc.start(noteStart);
      osc.stop(noteEnd + 0.01);
    }
  }

  /** Reset debounce timers (e.g., when starting a new session). */
  resetDebounce(): void {
    this.lastPlayTimes.clear();
  }

  /** Enable or disable audio output. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = enabled ? 1 : 0;
    }
  }

  /** Check if audio is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Check if audio is supported in this environment. */
  isSupported(): boolean {
    return globalThis.window !== undefined && "AudioContext" in globalThis;
  }

  /** Clean up audio resources. */
  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.masterGain = null;
      this.stereoPanner = null;
      this.initialized = false;
      this.lastPlayTimes.clear();
      this.speechEngineRef = null;
    }
  }
}

/** Singleton instance for the liveness audio engine. */
export const audioEngine = new LivenessAudioEngine();
