"use client";

import { QRCodeSVG } from "qrcode.react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useIsMobileDevice } from "@/lib/browser-hooks";

interface QrDisplayProps {
  url: string;
}

export function QrDisplay({ url }: Readonly<QrDisplayProps>) {
  const isMobile = useIsMobileDevice();

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
        <QRCodeSVG
          className="max-w-full rounded-lg"
          level="M"
          marginSize={2}
          role="img"
          size={280}
          title="QR code to connect with ZKPassport app"
          value={url}
        />
      </CardContent>
    </Card>
  );
}
