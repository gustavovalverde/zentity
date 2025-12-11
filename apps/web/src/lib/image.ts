/**
 * Lightweight client-side image resizing/compression for uploads.
 * Avoids pulling an external dependency while keeping payloads small.
 */
export type ResizeOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1 for JPEG/WebP
};

type ResizeResult = {
  file: File;
  dataUrl: string;
};

export async function resizeImageFile(
  file: File,
  { maxWidth = 1600, maxHeight = 1600, quality = 0.85 }: ResizeOptions = {},
): Promise<ResizeResult> {
  if (typeof window === "undefined") {
    throw new Error("resizeImageFile must run in the browser");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Provided file is not an image");
  }

  const bitmap = await createImageBitmap(file);

  const { width, height } = constrainSize(
    bitmap.width,
    bitmap.height,
    maxWidth,
    maxHeight,
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context");

  ctx.drawImage(bitmap, 0, 0, width, height);

  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mimeType, quality);

  const resizedBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), mimeType, quality),
  );
  if (!resizedBlob) throw new Error("Failed to create blob from canvas");

  const resizedFile = new File([resizedBlob], file.name, {
    type: mimeType,
    lastModified: Date.now(),
  });

  return { file: resizedFile, dataUrl };
}

function constrainSize(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}
