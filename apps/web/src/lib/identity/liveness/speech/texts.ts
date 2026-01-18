/**
 * Speech texts for liveness detection TTS feedback.
 * Supports multiple languages using the Web Speech API.
 *
 * Privacy: Web Speech API runs entirely in the browser using
 * the device's built-in TTS engine. No data leaves the device.
 */

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

/**
 * Speech texts organized by language.
 * Kept concise for quick TTS delivery.
 */
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

/**
 * Get the language code for Web Speech API from browser locale.
 */
export function detectLanguage(): SupportedLanguage {
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

/**
 * Get speech text for a key in the specified or detected language.
 */
export function getSpeechText(
  key: SpeechKey,
  lang?: SupportedLanguage
): string {
  const language = lang ?? detectLanguage();
  return SPEECH_TEXTS[language][key];
}

/**
 * Get the full locale code for Web Speech API.
 */
export function getLocaleCode(lang: SupportedLanguage): string {
  const localeMap: Record<SupportedLanguage, string> = {
    en: "en-US",
    es: "es-ES",
    pt: "pt-BR",
  };
  return localeMap[lang];
}
