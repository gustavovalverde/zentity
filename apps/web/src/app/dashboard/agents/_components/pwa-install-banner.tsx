"use client";

import { Download, Share } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "pwa-install-banner-dismissed";
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const IOS_DEVICE_RE = /iPhone|iPod/;
const MAC_UA_RE = /Macintosh/;

type BannerState = "hidden" | "chromium" | "ios" | "loading";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Capture the install prompt at module scope so it survives the gap
// between page load and React hydration. Chrome fires this event once
// per navigation — if we only listen inside useEffect, we miss it
// when hydration is slower than Chrome's installability check.
let capturedPrompt: BeforeInstallPromptEvent | null = null;
const captureListeners = new Set<() => void>();

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    capturedPrompt = e as BeforeInstallPromptEvent;
    for (const listener of captureListeners) {
      listener();
    }
  });
}

function isIOSDevice(): boolean {
  if (IOS_DEVICE_RE.test(navigator.userAgent)) {
    return true;
  }
  // iPadOS 13+ spoofs a Mac user agent — detect via touch support.
  const uaData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const isMac = uaData.userAgentData?.platform
    ? uaData.userAgentData.platform === "macOS"
    : MAC_UA_RE.test(navigator.userAgent);

  return isMac && navigator.maxTouchPoints > 1;
}

function isStandalone(): boolean {
  return (
    globalThis.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as { standalone?: boolean }).standalone === true)
  );
}

function isDismissed(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) {
    return false;
  }
  const timestamp = Number(dismissed);
  return Date.now() - timestamp < DISMISS_COOLDOWN_MS;
}

export function PwaInstallBanner() {
  const [state, setState] = useState<BannerState>("loading");
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || isDismissed()) {
      setState("hidden");
      return;
    }

    if (isIOSDevice()) {
      setState("ios");
      return;
    }

    // Check if the event was already captured before this component mounted
    if (capturedPrompt) {
      promptRef.current = capturedPrompt;
      setState("chromium");
      return;
    }

    // Listen for future events via the module-level capture set
    const onCapture = () => {
      if (capturedPrompt) {
        promptRef.current = capturedPrompt;
        setState("chromium");
      }
    };
    captureListeners.add(onCapture);

    // No event yet and not iOS — stay hidden (Firefox, Safari desktop)
    setState("hidden");

    return () => {
      captureListeners.delete(onCapture);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) {
      return;
    }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setState("hidden");
    }
    promptRef.current = null;
    capturedPrompt = null;
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setState("hidden");
  }, []);

  if (state === "loading" || state === "hidden") {
    return null;
  }

  if (state === "ios") {
    return (
      <Alert variant="info">
        <Share />
        <AlertTitle>Install Zentity</AlertTitle>
        <AlertDescription>
          <span>
            Tap the share button in Safari, then &ldquo;Add to Home
            Screen&rdquo; for faster agent approvals.
          </span>
          <Button
            className="mt-1"
            onClick={handleDismiss}
            size="sm"
            variant="ghost"
          >
            Dismiss
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="info">
      <Download />
      <AlertTitle>Install Zentity</AlertTitle>
      <AlertDescription>
        <span>Install the app for faster agent approvals.</span>
        <div className="mt-1 flex gap-2">
          <Button onClick={handleInstall} size="sm">
            Install
          </Button>
          <Button onClick={handleDismiss} size="sm" variant="ghost">
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
