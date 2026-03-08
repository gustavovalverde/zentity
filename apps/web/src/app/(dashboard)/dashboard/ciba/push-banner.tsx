"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getPushState,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/client";

type PushState = "unsupported" | "prompt" | "granted" | "denied" | "loading";

export function PushNotificationBanner() {
  const [state, setState] = useState<PushState>("loading");

  useEffect(() => {
    setState(getPushState());
  }, []);

  const handleEnable = useCallback(async () => {
    setState("loading");
    const sub = await subscribeToPush();
    setState(sub ? "granted" : getPushState());
  }, []);

  const handleDisable = useCallback(async () => {
    setState("loading");
    await unsubscribeFromPush();
    setState("prompt");
  }, []);

  if (state === "loading" || state === "unsupported") {
    return null;
  }

  if (state === "granted") {
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
