import { type NextRequest, NextResponse } from "next/server";
import { getEmbeddingVector, getLargestFace } from "@/lib/human-metrics";
import { detectFromBase64, getHumanServer } from "@/lib/human-server";
import { cropFaceRegion } from "@/lib/image-processing";

export const runtime = "nodejs";

interface FaceMatchRequest {
  idImage: string;
  selfieImage: string;
  minConfidence?: number;
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
    const idFaceInitial = getLargestFace(idResultInitial);

    let idResult = idResultInitial;
    // Track cropped face for UI display
    let croppedFaceDataUrl: string | null = null;

    // If we found a face in the document, crop and re-process for better embedding
    if (idFaceInitial?.box) {
      try {
        // Human.js box can be array [x,y,w,h] or object {x,y,width,height}
        const box = Array.isArray(idFaceInitial.box)
          ? {
              x: idFaceInitial.box[0],
              y: idFaceInitial.box[1],
              width: idFaceInitial.box[2],
              height: idFaceInitial.box[3],
            }
          : idFaceInitial.box;

        // Crop face region and re-process
        croppedFaceDataUrl = await cropFaceRegion(body.idImage, box);
        idResult = await detectFromBase64(croppedFaceDataUrl);
      } catch (_err) {}
    }

    const selfieResult = await detectFromBase64(body.selfieImage);

    const idFace = getLargestFace(idResult);
    const selfieFace = getLargestFace(selfieResult);

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
            id_faces_detected: idFaceInitial ? 1 : 0,
            selfie_faces_detected: selfieResult?.face?.length ?? 0,
            cropping_applied: Boolean(croppedFaceDataUrl),
          },
        },
        { status: 200 },
      );
    }

    const idEmb = getEmbeddingVector(idFace);
    const selfieEmb = getEmbeddingVector(selfieFace);

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
            id_faces_detected: idFaceInitial ? 1 : 0,
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
        id_faces_detected: idFaceInitial ? 1 : 0,
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
