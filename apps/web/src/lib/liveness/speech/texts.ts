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
export const SPEECH_TEXTS: Record<
  SupportedLanguage,
  Record<SpeechKey, string>
> = {
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

/**
 * Screen reader-specific texts for accessibility.
 * These are longer and more descriptive than TTS texts for
 * better context when using assistive technologies.
 */
export type ScreenReaderKey =
  | "sr_face_detected"
  | "sr_challenge_smile"
  | "sr_challenge_turn_left"
  | "sr_challenge_turn_right"
  | "sr_progress_50"
  | "sr_verification_success"
  | "sr_verification_failed"
  | "sr_retry_in_progress"
  | "sr_countdown_starting"
  | "sr_connecting";

export const SCREEN_READER_TEXTS: Record<
  SupportedLanguage,
  Record<ScreenReaderKey, string>
> = {
  en: {
    sr_face_detected: "Face detected. Hold still for countdown.",
    sr_challenge_smile: "Challenge: Please smile for the camera.",
    sr_challenge_turn_left: "Challenge: Turn your head to the left.",
    sr_challenge_turn_right: "Challenge: Turn your head to the right.",
    sr_progress_50: "Halfway there, keep going.",
    sr_verification_success: "Verification complete. You may proceed.",
    sr_verification_failed: "Verification failed. Please try again.",
    sr_retry_in_progress: "Retrying verification automatically.",
    sr_countdown_starting: "Starting countdown. Hold still.",
    sr_connecting: "Connecting to verification server.",
  },

  es: {
    sr_face_detected:
      "Rostro detectado. Quédese quieto para la cuenta regresiva.",
    sr_challenge_smile: "Desafío: Por favor sonría a la cámara.",
    sr_challenge_turn_left: "Desafío: Gire la cabeza hacia la izquierda.",
    sr_challenge_turn_right: "Desafío: Gire la cabeza hacia la derecha.",
    sr_progress_50: "A mitad de camino, continúe.",
    sr_verification_success: "Verificación completa. Puede continuar.",
    sr_verification_failed: "Verificación fallida. Por favor intente de nuevo.",
    sr_retry_in_progress: "Reintentando verificación automáticamente.",
    sr_countdown_starting: "Iniciando cuenta regresiva. Quédese quieto.",
    sr_connecting: "Conectando al servidor de verificación.",
  },

  pt: {
    sr_face_detected:
      "Rosto detectado. Fique parado para a contagem regressiva.",
    sr_challenge_smile: "Desafio: Por favor sorria para a câmera.",
    sr_challenge_turn_left: "Desafio: Vire a cabeça para a esquerda.",
    sr_challenge_turn_right: "Desafio: Vire a cabeça para a direita.",
    sr_progress_50: "Na metade, continue.",
    sr_verification_success: "Verificação completa. Você pode prosseguir.",
    sr_verification_failed: "Verificação falhou. Por favor tente novamente.",
    sr_retry_in_progress: "Tentando verificação novamente automaticamente.",
    sr_countdown_starting: "Iniciando contagem regressiva. Fique parado.",
    sr_connecting: "Conectando ao servidor de verificação.",
  },
};

/**
 * Get screen reader text for a key in the specified or detected language.
 */
export function getScreenReaderText(
  key: ScreenReaderKey,
  lang?: SupportedLanguage
): string {
  const language = lang ?? detectLanguage();
  return SCREEN_READER_TEXTS[language][key];
}
