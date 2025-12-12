import { type NextRequest, NextResponse } from "next/server";
import {
  detectFromBase64,
  getHumanServer,
  stripDataUrl,
} from "@/lib/human-server";

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
  type Tensor3D = any;

  const base64 = stripDataUrl(dataUrl);
  const buffer = Buffer.from(base64, "base64");
  const decoded = tf.node.decodeImage(buffer, 3);
  if (decoded.rank !== 3) {
    decoded.dispose();
    throw new Error("Animated images are not supported");
  }
  const tensor = decoded as Tensor3D;

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
  const cropped = tf.slice(tensor, [y1, x1, 0], [
    cropHeight,
    cropWidth,
    3,
  ]) as Tensor3D;
  tensor.dispose();

  // Encode back to JPEG
  const encoded = await tf.node.encodeJpeg(cropped, "rgb", 95);
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

    // Helper to get box dimensions (handles array or object format)
    const getBoxArea = (box: any): number => {
      if (!box) return 0;
      if (Array.isArray(box)) return (box[2] ?? 0) * (box[3] ?? 0);
      return (box.width ?? 0) * (box.height ?? 0);
    };

    // If we found a face in the document, crop and re-process for better embedding
    if (idFacesInitial.length > 0) {
      const largestFace = idFacesInitial.reduce((best: any, f: any) => {
        const bestArea = getBoxArea(best?.box);
        const area = getBoxArea(f?.box);
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

          console.log("[face-match] Box format:", {
            original: largestFace.box,
            normalized: box,
          });

          // Crop face region and re-process
          croppedFaceDataUrl = await cropFaceRegion(body.idImage, box);
          idResult = await detectFromBase64(croppedFaceDataUrl);
        } catch (err) {
          // Fall back to original result if cropping fails
          console.warn("[face-match] Face cropping failed:", err);
        }
      }
    }

    const selfieResult = await detectFromBase64(body.selfieImage);

    const selectLargestFace = (res: any) => {
      const faces = Array.isArray(res?.face) ? res.face : [];
      if (faces.length === 0) return null;
      return faces.reduce((best: any, f: any) => {
        const bestArea = getBoxArea(best?.box);
        const area = getBoxArea(f?.box);
        return area > bestArea ? f : best;
      }, faces[0]);
    };

    const getEmbedding = (face: any): number[] | null => {
      const emb =
        face?.embedding ??
        face?.descriptor ??
        face?.description?.embedding ??
        face?.description;
      if (!emb) return null;
      if (Array.isArray(emb)) return emb.map((n) => Number(n));
      if (emb instanceof Float32Array) return Array.from(emb);
      if (typeof emb === "object" && Array.isArray(emb.data)) {
        return emb.data.map((n: any) => Number(n));
      }
      return null;
    };

    const idFace = selectLargestFace(idResult);
    const selfieFace = selectLargestFace(selfieResult);

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

    console.log("[face-match] Result:", {
      confidence: confidence.toFixed(4),
      threshold: minConfidence,
      matched,
      idEmbeddingLength: idEmb.length,
      selfieEmbeddingLength: selfieEmb.length,
    });

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
