/**
 * Liveness non-visual feedback: haptics, earcon audio, and TTS speech.
 *
 * All three feedback channels coordinate during verification: the audio
 * engine skips non-critical earcons while speech is playing, and each
 * engine is independently enable/disable-able. Everything runs locally
 * in the browser (Vibration API, Web Audio API, Web Speech API); no
 * data leaves the device.
 */

import { reportRejection } from "@/lib/async-handler";

// ===========================================================================
// Haptics (Vibration API)
// ===========================================================================

export type HapticType =
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
 * Vibration patterns for each feedback event.
 *
 * Design principles:
 * - Short pulses = quick acknowledgment
 * - Double pulses = warning/attention
 * - Ascending patterns = success
 * - Long pulses = important events
 */
export const HAPTIC_PATTERNS: Record<HapticType, number | number[]> = {
  /**
   * Face detected - single short pulse
   * Subtle confirmation that face entered frame
   */
  faceDetected: 50,

  /**
   * Face lost - double pulse warning
   * Distinct pattern to alert user without being alarming
   */
  faceLost: [30, 50, 30],

  /**
   * Challenge progress - micro tick
   * Very subtle feedback for progress milestones
   */
  challengeProgress: 20,

  /**
   * Challenge passed - ascending pattern
   * Satisfying "completed" feeling
   */
  challengePassed: [50, 30, 80],

  /**
   * Verification complete - celebration pattern
   * Distinctive "fanfare" pattern
   */
  verificationComplete: [100, 50, 100, 50, 150],

  /**
   * Error - long warning pattern
   * Clearly different from success patterns
   */
  error: [200, 100, 200],

  /**
   * Countdown tick - quick pulse
   * Used for 3, 2, 1 countdown
   */
  countdown: 30,

  /**
   * Countdown 3 - triple pulse
   */
  countdown3: [30, 40, 30, 40, 30],

  /**
   * Countdown 2 - double pulse
   */
  countdown2: [40, 50, 40],

  /**
   * Countdown 1 - single longer pulse
   */
  countdown1: 60,
};

/**
 * Trigger haptic feedback with the specified pattern.
 * @returns true if vibration was triggered, false if not supported
 */
export function vibrate(pattern: number | number[]): boolean {
  if (!isHapticsSupported()) {
    return false;
  }

  try {
    navigator.vibrate(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if haptic feedback is supported on this device.
 */
export function isHapticsSupported(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

// ===========================================================================
// Audio earcons (Web Audio API)
// ===========================================================================

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
        this.audioContext.resume().catch(reportRejection);
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
      this.audioContext.close().catch(reportRejection);
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

// ===========================================================================
// Speech synthesis (Web Speech API)
// ===========================================================================

// ---------------------------------------------------------------------------
// Speech texts (EN/ES/PT)
// ---------------------------------------------------------------------------

export type SpeechKey =
  | "positionFace"
  | "holdStill"
  | "smile"
  | "turnLeft"
  | "turnRight"
  | "faceDetected"
  | "faceLost"
  | "challengePassed"
  | "verificationComplete"
  | "verifying"
  | "tryAgain"
  | "countdown3"
  | "countdown2"
  | "countdown1";

export type SupportedLanguage = "en" | "es" | "pt";

const SPEECH_TEXTS: Record<SupportedLanguage, Record<SpeechKey, string>> = {
  en: {
    positionFace: "Position your face in the oval",
    holdStill: "Hold still",
    smile: "Please smile",
    turnLeft: "Turn your head left",
    turnRight: "Turn your head right",
    faceDetected: "Face detected",
    faceLost: "Face lost, please reposition",
    challengePassed: "Perfect",
    verificationComplete: "Verification complete",
    verifying: "Verifying",
    tryAgain: "Let's try again",
    countdown3: "Three",
    countdown2: "Two",
    countdown1: "One",
  },

  es: {
    positionFace: "Posicione su rostro en el óvalo",
    holdStill: "Quédese quieto",
    smile: "Por favor sonría",
    turnLeft: "Gire la cabeza a la izquierda",
    turnRight: "Gire la cabeza a la derecha",
    faceDetected: "Rostro detectado",
    faceLost: "Rostro perdido, reposicione",
    challengePassed: "Perfecto",
    verificationComplete: "Verificación completada",
    verifying: "Verificando",
    tryAgain: "Intentemos de nuevo",
    countdown3: "Tres",
    countdown2: "Dos",
    countdown1: "Uno",
  },

  pt: {
    positionFace: "Posicione seu rosto no oval",
    holdStill: "Fique parado",
    smile: "Por favor sorria",
    turnLeft: "Vire a cabeça para a esquerda",
    turnRight: "Vire a cabeça para a direita",
    faceDetected: "Rosto detectado",
    faceLost: "Rosto perdido, reposicione",
    challengePassed: "Perfeito",
    verificationComplete: "Verificação completa",
    verifying: "Verificando",
    tryAgain: "Vamos tentar novamente",
    countdown3: "Três",
    countdown2: "Dois",
    countdown1: "Um",
  },
};

/** Get the language code for Web Speech API from browser locale. */
function detectLanguage(): SupportedLanguage {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const browserLang = navigator.language.toLowerCase();

  if (browserLang.startsWith("es")) {
    return "es";
  }
  if (browserLang.startsWith("pt")) {
    return "pt";
  }

  return "en";
}

/** Get speech text for a key in the specified or detected language. */
function getSpeechText(key: SpeechKey, lang?: SupportedLanguage): string {
  const language = lang ?? detectLanguage();
  return SPEECH_TEXTS[language][key];
}

/** Get the full locale code for Web Speech API. */
function getLocaleCode(lang: SupportedLanguage): string {
  const localeMap: Record<SupportedLanguage, string> = {
    en: "en-US",
    es: "es-ES",
    pt: "pt-BR",
  };
  return localeMap[lang];
}

// ---------------------------------------------------------------------------
// Speech engine (singleton)
// ---------------------------------------------------------------------------

interface SpeechOptions {
  lang?: SupportedLanguage;
  pitch?: number; // 0 to 2, default 1
  priority?: "low" | "high"; // high = cancel current speech
  rate?: number; // 0.1 to 10, default 0.95
  volume?: number; // 0 to 1, default 1
}

class LivenessSpeechEngine {
  private enabled = true;
  private language: SupportedLanguage = "en";
  private readonly pendingIntervals: Set<ReturnType<typeof setInterval>> =
    new Set();

  constructor() {
    this.language = detectLanguage();
  }

  /**
   * Initialize speech synthesis (call from user gesture).
   * Chrome requires user activation for Web Speech API since M71.
   * Must be called during a click/tap handler, not in async code.
   */
  init(): void {
    if (!this.isSupported()) {
      return;
    }

    const synth = globalThis.window.speechSynthesis;

    synth.getVoices();

    // Chrome workaround: speak silent utterance to activate synthesis
    const utterance = new SpeechSynthesisUtterance("");
    utterance.volume = 0;
    synth.speak(utterance);
  }

  /** Cancel all pending polling intervals (queued low-priority speech). */
  private cancelAllPending(): void {
    for (const interval of this.pendingIntervals) {
      clearInterval(interval);
    }
    this.pendingIntervals.clear();
  }

  /**
   * Speak text using the Web Speech API.
   * Returns a promise that resolves when speech completes.
   */
  speak(text: string, options: SpeechOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!(this.enabled && this.isSupported())) {
        resolve();
        return;
      }

      const synth = globalThis.window.speechSynthesis;

      if (options.priority === "high") {
        this.cancelAllPending();
        if (synth.speaking || synth.pending) {
          synth.cancel();
        }
      }

      if (options.priority !== "high" && (synth.speaking || synth.pending)) {
        const checkInterval = setInterval(() => {
          if (!(synth.speaking || synth.pending)) {
            this.pendingIntervals.delete(checkInterval);
            clearInterval(checkInterval);
            this.doSpeak(text, options, resolve, reject);
          }
        }, 50);
        this.pendingIntervals.add(checkInterval);
        return;
      }

      this.doSpeak(text, options, resolve, reject);
    });
  }

  private doSpeak(
    text: string,
    options: SpeechOptions,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const synth = globalThis.window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);

    const lang = options.lang ?? this.language;
    utterance.lang = getLocaleCode(lang);
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    const voices = synth.getVoices();
    const langPrefix = lang.toLowerCase();
    const matchesLang = (voice: SpeechSynthesisVoice) =>
      voice.lang.toLowerCase().startsWith(langPrefix);
    const langVoice =
      voices.find((voice) => matchesLang(voice) && voice.localService) ??
      voices.find((voice) => matchesLang(voice) && voice.default) ??
      voices.find((voice) => matchesLang(voice)) ??
      voices.find((voice) => voice.default) ??
      voices[0];
    if (langVoice) {
      utterance.voice = langVoice;
      utterance.lang = langVoice.lang;
    }

    utterance.onend = () => {
      resolve();
    };

    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") {
        resolve();
      } else {
        reject(new Error(`Speech error: ${event.error}`));
      }
    };

    synth.resume();
    synth.speak(utterance);
  }

  /** Speak a predefined speech key. */
  speakKey(key: SpeechKey, options: SpeechOptions = {}): Promise<void> {
    const lang = options.lang ?? this.language;
    const text = getSpeechText(key, lang);
    return this.speak(text, options);
  }

  /** Cancel any ongoing speech AND all pending queued speech. */
  cancel(): void {
    this.cancelAllPending();
    if (this.isSupported()) {
      globalThis.window.speechSynthesis.cancel();
    }
  }

  isSpeaking(): boolean {
    if (!this.isSupported()) {
      return false;
    }
    return globalThis.window.speechSynthesis.speaking;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setLanguage(lang: SupportedLanguage): void {
    this.language = lang;
  }

  getLanguage(): SupportedLanguage {
    return this.language;
  }

  isSupported(): boolean {
    return globalThis.window !== undefined && "speechSynthesis" in globalThis;
  }

  /** Get available voices for the current language. */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) {
      return [];
    }

    const voices = globalThis.window.speechSynthesis.getVoices();
    return voices.filter((v) => v.lang.startsWith(this.language));
  }
}

/** Singleton instance for the liveness speech engine. */
export const speechEngine = new LivenessSpeechEngine();
