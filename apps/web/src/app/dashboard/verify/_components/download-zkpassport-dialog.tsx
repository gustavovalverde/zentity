"use client";

import { Apple, SmartphoneNfc } from "lucide-react";
import Image from "next/image";
import { toDataURL } from "qrcode";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reportRejection } from "@/lib/async-handler";

const STORE_URLS = {
  ios: "https://apps.apple.com/app/zkpassport/id6477371975",
  android:
    "https://play.google.com/store/apps/details?id=app.zkpassport.zkpassport",
} as const;

const MOBILE_UA_PATTERN = /iPhone|iPad|iPod|Android/i;
const IOS_UA_PATTERN = /iPhone|iPad|iPod/i;
const ANDROID_UA_PATTERN = /Android/i;

function useIsMobile() {
  return useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    return MOBILE_UA_PATTERN.test(navigator.userAgent);
  }, []);
}

function usePlatform() {
  return useMemo(() => {
    if (typeof navigator === "undefined") {
      return "unknown";
    }
    if (IOS_UA_PATTERN.test(navigator.userAgent)) {
      return "ios" as const;
    }
    if (ANDROID_UA_PATTERN.test(navigator.userAgent)) {
      return "android" as const;
    }
    return "unknown" as const;
  }, []);
}

const QR_SIZE = 220;

function StoreQrCode({ url }: Readonly<{ url: string }>) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    toDataURL(url, { width: QR_SIZE, margin: 2 })
      .then(setQrDataUrl)
      .catch(reportRejection);
  }, [url]);

  if (!qrDataUrl) {
    return (
      <div className="flex aspect-square w-full max-w-[220px] items-center justify-center rounded-lg bg-muted">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    );
  }

  return (
    <a href={url} rel="noopener noreferrer" target="_blank">
      <Image
        alt="Scan to download ZKPassport"
        className="max-w-full rounded-lg"
        height={QR_SIZE}
        src={qrDataUrl}
        width={QR_SIZE}
      />
    </a>
  );
}

/**
 * On desktop: opens a dialog with iPhone/Android tabs showing QR codes.
 * On mobile: renders direct store links (iOS users see App Store, Android
 * users see Play Store, unknown shows both).
 */
export function DownloadZkPassportDialog() {
  const isMobile = useIsMobile();
  const platform = usePlatform();

  if (isMobile) {
    if (platform === "ios") {
      return (
        <a
          className="underline underline-offset-2"
          href={STORE_URLS.ios}
          rel="noopener noreferrer"
          target="_blank"
        >
          App Store
        </a>
      );
    }
    if (platform === "android") {
      return (
        <a
          className="underline underline-offset-2"
          href={STORE_URLS.android}
          rel="noopener noreferrer"
          target="_blank"
        >
          Play Store
        </a>
      );
    }
    // Unknown mobile — show both
    return (
      <>
        <a
          className="underline underline-offset-2"
          href={STORE_URLS.ios}
          rel="noopener noreferrer"
          target="_blank"
        >
          iOS
        </a>
        {" / "}
        <a
          className="underline underline-offset-2"
          href={STORE_URLS.android}
          rel="noopener noreferrer"
          target="_blank"
        >
          Android
        </a>
      </>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          className="cursor-pointer underline underline-offset-2"
          type="button"
        >
          download
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Download ZKPassport</DialogTitle>
          <DialogDescription>
            Select your platform and scan the QR code to download the app
          </DialogDescription>
        </DialogHeader>
        <Tabs className="w-full" defaultValue="ios">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ios">
              <Apple className="h-4 w-4" />
              iPhone
            </TabsTrigger>
            <TabsTrigger value="android">
              <SmartphoneNfc className="h-4 w-4" />
              Android
            </TabsTrigger>
          </TabsList>
          <TabsContent className="flex justify-center pt-2" value="ios">
            <StoreQrCode url={STORE_URLS.ios} />
          </TabsContent>
          <TabsContent className="flex justify-center pt-2" value="android">
            <StoreQrCode url={STORE_URLS.android} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
