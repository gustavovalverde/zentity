"use client";

import { Bell, BellOff, BellRing, Share } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/client";

type PushState =
  | "unsupported"
  | "prompt"
  | "subscribed"
  | "unsubscribed"
  | "denied"
  | "loading";

const IOS_DEVICE_RE = /iPhone|iPod/;

function isIOSDevice(): boolean {
  // iPhone/iPod still report correctly in the user agent
  if (IOS_DEVICE_RE.test(navigator.userAgent)) {
    return true;
  }
  // iPadOS 13+ spoofs a Mac user agent — detect via touch support
  // Real Macs have maxTouchPoints === 0; iPads report > 0
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function useIsIOSInstallable(): boolean {
  const [isIOSInstallable, setIsIOSInstallable] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia(
      "(display-mode: standalone)"
    ).matches;
    setIsIOSInstallable(isIOSDevice() && !isStandalone);
  }, []);

  return isIOSInstallable;
}

export function PushNotificationBanner() {
  const [state, setState] = useState<PushState>("loading");
  const isIOSInstallable = useIsIOSInstallable();

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  const handleEnable = useCallback(async () => {
    setState("loading");
    const sub = await subscribeToPush();
    setState(sub ? "subscribed" : await getPushState());
  }, []);

  const handleDisable = useCallback(async () => {
    setState("loading");
    await unsubscribeFromPush();
    setState("prompt");
  }, []);

  if (state === "loading") {
    return null;
  }

  if (state === "unsupported") {
    if (!isIOSInstallable) {
      return null;
    }
    return (
      <Alert variant="info">
        <Share />
        <AlertTitle>Install for push notifications</AlertTitle>
        <AlertDescription>
          Tap the share button in Safari, then &ldquo;Add to Home Screen&rdquo;
          to enable instant notifications for agent requests.
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "subscribed") {
    return (
      <Alert variant="success">
        <BellRing />
        <AlertTitle>Push notifications active</AlertTitle>
        <AlertDescription>
          <span>
            You&apos;ll receive instant notifications for agent requests.
          </span>
          <Button
            className="mt-1"
            onClick={handleDisable}
            size="sm"
            variant="ghost"
          >
            Disable
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (state === "denied") {
    return (
      <Alert variant="warning">
        <BellOff />
        <AlertTitle>Notifications blocked</AlertTitle>
        <AlertDescription>
          Push notifications are blocked in your browser settings. To enable
          them, update notification permissions for this site.
        </AlertDescription>
      </Alert>
    );
  }

  // "prompt" or "unsubscribed" — both show the enable button
  return (
    <Alert variant="info">
      <Bell />
      <AlertTitle>Get instant agent notifications</AlertTitle>
      <AlertDescription>
        <span>
          Enable push notifications to approve or deny agent requests without
          checking email.
        </span>
        <Button className="mt-1" onClick={handleEnable} size="sm">
          Enable Notifications
        </Button>
      </AlertDescription>
    </Alert>
  );
}
