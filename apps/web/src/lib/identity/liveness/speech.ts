/**
 * Liveness TTS feedback via the Web Speech API.
 *
 * - Localized speech texts (EN/ES/PT)
 * - Singleton engine that wraps the browser's speechSynthesis
 *
 * Privacy: Web Speech API runs entirely in the browser using the device's
 * built-in TTS engine. No data leaves the device.
 */

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
