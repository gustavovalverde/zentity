import type { Box } from "@vladmandic/human";

import { dataUrlToBuffer } from "@/lib/identity/liveness/human/server";

/**
 * Crop face region from image and return as base64 data URL.
 * This improves embedding quality for small faces in large documents.
 *
 * @param dataUrl - Base64 encoded image data URL
 * @param box - Human.js face box as [x, y, width, height]
 * @param padding - Padding around face (default 30%)
 * @returns Base64 data URL of cropped face region
 */
export async function cropFaceRegion(
  dataUrl: string,
  [boxX, boxY, boxW, boxH]: Box,
  padding = 0.3
): Promise<string> {
  const tf = await import("@tensorflow/tfjs-node");

  const decoded = tf.node.decodeImage(dataUrlToBuffer(dataUrl), 3);
  if (decoded.rank !== 3) {
    decoded.dispose();
    throw new Error("Animated images are not supported");
  }
  const tensor = decoded;

  const height = tensor.shape[0];
  const width = tensor.shape[1];

  // Calculate padded crop region
  const padW = boxW * padding;
  const padH = boxH * padding;
  const x1 = Math.max(0, Math.floor(boxX - padW));
  const y1 = Math.max(0, Math.floor(boxY - padH));
  const x2 = Math.min(width, Math.ceil(boxX + boxW + padW));
  const y2 = Math.min(height, Math.ceil(boxY + boxH + padH));

  const cropWidth = x2 - x1;
  const cropHeight = y2 - y1;

  const cropped = tf.slice(tensor, [y1, x1, 0], [cropHeight, cropWidth, 3]);
  tensor.dispose();

  // Cast to unknown first to bypass TypeScript's strict union type checking
  // Safe because we verified rank === 3 above
  const encoded = await tf.node.encodeJpeg(
    cropped as unknown as Parameters<typeof tf.node.encodeJpeg>[0],
    "rgb",
    95
  );
  cropped.dispose();

  return `data:image/jpeg;base64,${Buffer.from(encoded).toString("base64")}`;
}
