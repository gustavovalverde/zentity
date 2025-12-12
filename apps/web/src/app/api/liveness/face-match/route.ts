import { type NextRequest, NextResponse } from "next/server";
import {
  detectFromBase64,
  getHumanServer,
  stripDataUrl,
} from "@/lib/human-server";
import type { EmbeddingData, FaceBox } from "@/types/human";
import { getBoxArea } from "@/types/human";

export const runtime = "nodejs";

interface FaceMatchRequest {
  idImage: string;
  selfieImage: string;
  minConfidence?: number;
}

/**
 * Crop face region from image and return as base64 data URL.
 * This improves embedding quality for small faces in large documents.
 */
async function cropFaceRegion(
  dataUrl: string,
  box: { x: number; y: number; width: number; height: number },
  padding = 0.3, // Add 30% padding around face
): Promise<string> {
  const tf = await import("@tensorflow/tfjs-node");

  const base64 = stripDataUrl(dataUrl);
  const buffer = Buffer.from(base64, "base64");
  const decoded = tf.node.decodeImage(buffer, 3);
  if (decoded.rank !== 3) {
    decoded.dispose();
    throw new Error("Animated images are not supported");
  }
  // Tensor is already the correct type after decodeImage with channels=3
  const tensor = decoded;

  const height = tensor.shape[0];
  const width = tensor.shape[1];

  // Calculate padded crop region
  const padW = box.width * padding;
  const padH = box.height * padding;
  const x1 = Math.max(0, Math.floor(box.x - padW));
  const y1 = Math.max(0, Math.floor(box.y - padH));
  const x2 = Math.min(width, Math.ceil(box.x + box.width + padW));
  const y2 = Math.min(height, Math.ceil(box.y + box.height + padH));

  const cropWidth = x2 - x1;
  const cropHeight = y2 - y1;

  // Crop the face region
  const cropped = tf.slice(tensor, [y1, x1, 0], [cropHeight, cropWidth, 3]);
  tensor.dispose();

  // Cast to unknown first to bypass TypeScript's strict union type checking
  // Safe because we verified rank === 3 above
  const encoded = await tf.node.encodeJpeg(
    cropped as unknown as Parameters<typeof tf.node.encodeJpeg>[0],
    "rgb",
    95,
  );
  cropped.dispose();

  const croppedBase64 = Buffer.from(encoded).toString("base64");
  return `data:image/jpeg;base64,${croppedBase64}`;
}

/**
 * POST /api/liveness/face-match
 * Face match using Human.js on the server.
 * For ID documents, we first detect the face, crop it, then re-process
 * for better embedding quality.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const body: FaceMatchRequest = await request.json();

    if (!body.idImage) {
      return NextResponse.json(
        { error: "ID image is required" },
        { status: 400 },
      );
    }

    if (!body.selfieImage) {
      return NextResponse.json(
        { error: "Selfie image is required" },
        { status: 400 },
      );
    }

    const human = await getHumanServer();
    // Lower threshold for ID photo comparison (passport photos are often years old,
    // different lighting/camera/expression, lower image quality)
    // 0.35-0.40 is typical for ID-to-selfie matching
    const minConfidence = body.minConfidence ?? 0.35;

    // First pass: detect faces in ID document to get bounding box
    const idResultInitial = await detectFromBase64(body.idImage);
    const idFacesInitial = Array.isArray(idResultInitial?.face)
      ? idResultInitial.face
      : [];

    let idResult = idResultInitial;
    // Track cropped face for UI display
    let croppedFaceDataUrl: string | null = null;

    // If we found a face in the document, crop and re-process for better embedding
    if (idFacesInitial.length > 0) {
      const largestFace = idFacesInitial.reduce((best, f) => {
        const bestArea = getBoxArea(best?.box as FaceBox | undefined);
        const area = getBoxArea(f?.box as FaceBox | undefined);
        return area > bestArea ? f : best;
      }, idFacesInitial[0]);

      if (largestFace?.box) {
        try {
          // Human.js box can be array [x,y,w,h] or object {x,y,width,height}
          const box = Array.isArray(largestFace.box)
            ? {
                x: largestFace.box[0],
                y: largestFace.box[1],
                width: largestFace.box[2],
                height: largestFace.box[3],
              }
            : largestFace.box;

          // Crop face region and re-process
          croppedFaceDataUrl = await cropFaceRegion(body.idImage, box);
          idResult = await detectFromBase64(croppedFaceDataUrl);
        } catch (_err) {}
      }
    }

    const selfieResult = await detectFromBase64(body.selfieImage);

    // Select largest face from detection result
    // Using unknown to handle Human.js library's complex types
    const selectLargestFace = (res: unknown) => {
      const result = res as { face?: Array<{ box?: unknown }> } | null;
      const faces = Array.isArray(result?.face) ? result.face : [];
      if (faces.length === 0) return null;
      return faces.reduce((best, f) => {
        const bestArea = getBoxArea(best?.box as FaceBox | undefined);
        const area = getBoxArea(f?.box as FaceBox | undefined);
        return area > bestArea ? f : best;
      }, faces[0]);
    };

    // Face result type with descriptor properties - permissive for Human.js
    interface FaceWithDescriptor {
      embedding?: EmbeddingData;
      descriptor?: EmbeddingData;
      description?: { embedding?: EmbeddingData } | EmbeddingData;
      box?: unknown;
    }

    const getEmbedding = (face: FaceWithDescriptor | null): number[] | null => {
      const emb: EmbeddingData =
        face?.embedding ??
        face?.descriptor ??
        (face?.description &&
        typeof face.description === "object" &&
        "embedding" in face.description
          ? face.description.embedding
          : (face?.description as EmbeddingData));
      if (!emb) return null;
      if (Array.isArray(emb)) return emb.map((n) => Number(n));
      if (emb instanceof Float32Array) return Array.from(emb);
      if (typeof emb === "object" && "data" in emb && Array.isArray(emb.data)) {
        return emb.data.map((n: number) => Number(n));
      }
      return null;
    };

    // Cast faces to FaceWithDescriptor for property access
    const idFace = selectLargestFace(idResult) as FaceWithDescriptor | null;
    const selfieFace = selectLargestFace(
      selfieResult,
    ) as FaceWithDescriptor | null;

    if (!idFace || !selfieFace) {
      return NextResponse.json(
        {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processing_time_ms: Date.now() - startTime,
          id_face_extracted: Boolean(idFace),
          id_face_image: croppedFaceDataUrl,
          error: !idFace
            ? "No face detected in ID document"
            : "No face detected in selfie",
          debug: {
            id_faces_detected: idFacesInitial.length,
            selfie_faces_detected: selfieResult?.face?.length ?? 0,
            cropping_applied: Boolean(croppedFaceDataUrl),
          },
        },
        { status: 200 },
      );
    }

    const idEmb = getEmbedding(idFace);
    const selfieEmb = getEmbedding(selfieFace);

    if (!idEmb || !selfieEmb) {
      return NextResponse.json(
        {
          matched: false,
          confidence: 0,
          distance: 1,
          threshold: minConfidence,
          processing_time_ms: Date.now() - startTime,
          id_face_extracted: true,
          id_face_image: croppedFaceDataUrl,
          error: !idEmb
            ? "Failed to extract ID face embedding"
            : "Failed to extract selfie face embedding",
          debug: {
            id_faces_detected: idFacesInitial.length,
            selfie_faces_detected: selfieResult?.face?.length ?? 0,
            cropping_applied: Boolean(croppedFaceDataUrl),
          },
        },
        { status: 200 },
      );
    }

    const confidence = human.match.similarity(idEmb, selfieEmb);
    const matched = confidence >= minConfidence;

    return NextResponse.json({
      matched,
      confidence,
      distance: 1 - confidence,
      threshold: minConfidence,
      processing_time_ms: Date.now() - startTime,
      id_face_extracted: true,
      id_face_image: croppedFaceDataUrl,
      debug: {
        id_faces_detected: idFacesInitial.length,
        selfie_faces_detected: selfieResult?.face?.length ?? 0,
        cropping_applied: Boolean(croppedFaceDataUrl),
      },
    });
  } catch (_error) {
    return NextResponse.json(
      {
        error: "Failed to perform face match",
        matched: false,
        confidence: 0,
      },
      { status: 500 },
    );
  }
}
