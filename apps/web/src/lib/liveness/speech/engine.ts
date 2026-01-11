/**
 * Web Speech API wrapper for liveness detection TTS.
 *
 * Privacy: Web Speech API runs entirely in the browser using
 * the device's built-in TTS engine. No data leaves the device.
 * This is safe for privacy-preserving applications.
 */

import {
  detectLanguage,
  getLocaleCode,
  getSpeechText,
  type SpeechKey,
  type SupportedLanguage,
} from "./texts";

interface SpeechOptions {
  lang?: SupportedLanguage;
  rate?: number; // 0.1 to 10, default 0.95
  pitch?: number; // 0 to 2, default 1
  volume?: number; // 0 to 1, default 1
  priority?: "low" | "high"; // high = cancel current speech
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

    const synth = window.speechSynthesis;

    // Trigger voice loading (Chrome loads voices async)
    synth.getVoices();

    // Chrome workaround: speak silent utterance to activate synthesis
    const utterance = new SpeechSynthesisUtterance("");
    utterance.volume = 0;
    synth.speak(utterance);
  }

  /**
   * Cancel all pending polling intervals (queued low-priority speech).
   */
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

      const synth = window.speechSynthesis;

      // Handle priority - cancel ALL pending AND current speech if high priority
      if (options.priority === "high") {
        this.cancelAllPending();
        if (synth.speaking || synth.pending) {
          synth.cancel();
        }
      }

      // Wait for any current/pending speech to finish if low priority
      if (options.priority !== "high" && (synth.speaking || synth.pending)) {
        // Queue for later with tracked interval
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
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);

    const lang = options.lang ?? this.language;
    utterance.lang = getLocaleCode(lang);
    utterance.rate = options.rate ?? 0.95;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    // Try to find a voice for the language (prefer local/offline voices)
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
      // Don't reject for interrupted - that's expected behavior
      if (event.error === "interrupted" || event.error === "canceled") {
        resolve();
      } else {
        reject(new Error(`Speech error: ${event.error}`));
      }
    };

    synth.resume();
    synth.speak(utterance);
  }

  /**
   * Speak a predefined speech key.
   */
  speakKey(key: SpeechKey, options: SpeechOptions = {}): Promise<void> {
    const lang = options.lang ?? this.language;
    const text = getSpeechText(key, lang);
    return this.speak(text, options);
  }

  /**
   * Cancel any ongoing speech AND all pending queued speech.
   */
  cancel(): void {
    this.cancelAllPending();
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Check if speech is currently in progress.
   */
  isSpeaking(): boolean {
    if (!this.isSupported()) {
      return false;
    }
    return window.speechSynthesis.speaking;
  }

  /**
   * Enable or disable speech output.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
    }
  }

  /**
   * Check if speech is currently enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set the default language.
   */
  setLanguage(lang: SupportedLanguage): void {
    this.language = lang;
  }

  /**
   * Get the current language.
   */
  getLanguage(): SupportedLanguage {
    return this.language;
  }

  /**
   * Check if Web Speech API is supported.
   */
  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  /**
   * Get available voices for the current language.
   */
  getVoices(): SpeechSynthesisVoice[] {
    if (!this.isSupported()) {
      return [];
    }

    const voices = window.speechSynthesis.getVoices();
    return voices.filter((v) => v.lang.startsWith(this.language));
  }
}

// Singleton instance
export const speechEngine = new LivenessSpeechEngine();

// Re-export for direct usage
export { LivenessSpeechEngine };
