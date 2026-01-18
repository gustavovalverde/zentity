/**
 * Web Audio API engine for liveness feedback.
 * Generates earcons programmatically without requiring audio files.
 *
 * Privacy: All audio is generated locally in the browser.
 * No data is sent to external services.
 */

import type { EarconConfig, EarconType } from "./earcons";

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

        // Create stereo panner for spatial audio (left/right directional cues)
        this.stereoPanner = this.audioContext.createStereoPanner();
        this.stereoPanner.connect(this.masterGain);
      }

      // Resume if suspended (happens after page becomes inactive)
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

    // Skip non-critical earcons during speech to avoid overlap
    if (
      earconType &&
      SKIP_DURING_SPEECH.has(earconType) &&
      this.speechEngineRef?.isSpeaking()
    ) {
      return;
    }

    // Debounce check - skip if same earcon type played too recently
    if (earconType) {
      const now = Date.now();
      const lastPlay = this.lastPlayTimes.get(earconType) ?? 0;
      const debounce = DEBOUNCE_MS[earconType] ?? 0;

      if (debounce > 0 && now - lastPlay < debounce) {
        return; // Skip - too soon
      }

      this.lastPlayTimes.set(earconType, now);
    }

    // Lazy init on first play
    if (!this.initialized) {
      this.init();
    }

    if (!(this.audioContext && this.masterGain)) {
      return;
    }

    const { frequencies, duration, type, envelope, volume = 0.7 } = config;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Calculate note duration based on number of frequencies
    const noteDuration = duration / frequencies.length / 1000;

    // Set stereo pan for directional cues
    if (this.stereoPanner && pan !== 0) {
      this.stereoPanner.pan.setValueAtTime(pan, now);
    }

    for (const [index, freq] of frequencies.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.value = freq;

      // Calculate timing for this note
      const noteStart = now + index * noteDuration;
      const attackEnd = noteStart + envelope.attack / 1000;
      const decayEnd = attackEnd + envelope.decay / 1000;
      const noteEnd = noteStart + noteDuration;

      // ADSR envelope
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(volume, attackEnd);
      gain.gain.linearRampToValueAtTime(envelope.sustain * volume, decayEnd);
      gain.gain.setValueAtTime(
        envelope.sustain * volume,
        noteEnd - envelope.release / 1000
      );
      gain.gain.linearRampToValueAtTime(0, noteEnd);

      osc.connect(gain);

      // Route through stereo panner if panning, otherwise direct to master
      if (pan !== 0 && this.stereoPanner) {
        gain.connect(this.stereoPanner);
      } else {
        gain.connect(this.masterGain);
      }

      osc.start(noteStart);
      osc.stop(noteEnd + 0.01); // Small buffer to ensure clean cutoff
    }
  }

  /**
   * Reset debounce timers (e.g., when starting a new session).
   */
  resetDebounce(): void {
    this.lastPlayTimes.clear();
  }

  /**
   * Enable or disable audio output.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain) {
      this.masterGain.gain.value = enabled ? 1 : 0;
    }
  }

  /**
   * Check if audio is currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if audio is supported in this environment.
   */
  isSupported(): boolean {
    return globalThis.window !== undefined && "AudioContext" in globalThis;
  }

  /**
   * Clean up audio resources.
   */
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

// Singleton instance for the liveness audio engine
export const audioEngine = new LivenessAudioEngine();
