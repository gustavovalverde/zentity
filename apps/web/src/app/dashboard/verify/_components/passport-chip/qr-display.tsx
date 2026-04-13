"use client";

import Image from "next/image";
import { toDataURL } from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { reportRejection } from "@/lib/async-handler";

const MOBILE_UA_PATTERN = /iPhone|iPad|iPod|Android/i;

function useIsMobile() {
  return useMemo(() => {
    if (typeof navigator === "undefined") {
      return false;
    }
    return MOBILE_UA_PATTERN.test(navigator.userAgent);
  }, []);
}

interface QrDisplayProps {
  url: string;
}

export function QrDisplay({ url }: Readonly<QrDisplayProps>) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isMobile) {
      return;
    }
    toDataURL(url, { width: 280, margin: 2 })
      .then(setQrDataUrl)
      .catch(reportRejection);
  }, [url, isMobile]);

  if (isMobile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open ZKPassport</CardTitle>
          <CardDescription>
            Tap the button below to open the ZKPassport app and scan your
            document.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full" size="lg">
            <a href={url}>Open ZKPassport App</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan with ZKPassport</CardTitle>
        <CardDescription>
          Open the ZKPassport app on your phone and scan this QR code.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        {qrDataUrl ? (
          <Image
            alt="QR code to connect with ZKPassport app"
            className="max-w-full rounded-lg"
            height={280}
            src={qrDataUrl}
            width={280}
          />
        ) : (
          <div className="flex aspect-square w-full max-w-[280px] items-center justify-center rounded-lg bg-muted">
            <span className="text-muted-foreground text-sm">
              Generating QR code...
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
