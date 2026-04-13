"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function CibaLiveUpdater() {
  const router = useRouter();

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) {
      return;
    }

    function onMessage(event: MessageEvent) {
      const type = event.data?.type;
      if (type === "ciba:new-request" || type === "ciba:status-changed") {
        router.refresh();
      }
    }

    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
