import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TtsBody = {
  text?: unknown;
  voiceId?: unknown;
  modelId?: unknown;
  outputFormat?: unknown;
  stability?: unknown;
  similarity?: unknown;
  style?: unknown;
};

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

/**
 * POST /api/tts — server-side proxy for ElevenLabs text-to-speech.
 * Keeps ELEVENLABS_API_KEY out of the browser. Returns the generated
 * audio (mp3) as the response body.
 *
 * Body: { text, voiceId?, modelId?, outputFormat? }
 */
export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "ELEVENLABS_API_KEY is not set. Add it to .env.local (see .env.example).",
      },
      { status: 500 },
    );
  }

  let body: TtsBody;
  try {
    body = (await request.json()) as TtsBody;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json(
      { error: "Provide a non-empty text to synthesize." },
      { status: 400 },
    );
  }
  if (text.length > 5000) {
    return Response.json(
      { error: "Text too long (max 5000 characters per request)." },
      { status: 413 },
    );
  }

  const voiceId =
    typeof body.voiceId === "string" && body.voiceId.trim()
      ? body.voiceId.trim()
      : DEFAULT_VOICE_ID;
  const modelId =
    typeof body.modelId === "string" && body.modelId.trim()
      ? body.modelId.trim()
      : DEFAULT_MODEL_ID;
  const outputFormat =
    typeof body.outputFormat === "string" && body.outputFormat.trim()
      ? (body.outputFormat.trim() as ElevenLabs.TextToSpeechConvertRequestOutputFormat)
      : ("mp3_44100_128" as ElevenLabs.TextToSpeechConvertRequestOutputFormat);

  const clamp01 = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.min(1, v))
      : fallback;
  const voiceSettings = {
    stability: clamp01(body.stability, 0.5),
    similarityBoost: clamp01(body.similarity, 0.75),
    style: clamp01(body.style, 0),
  };

  try {
    const client = new ElevenLabsClient({ apiKey });
    const stream = await client.textToSpeech.convert(voiceId, {
      text,
      modelId,
      outputFormat,
      voiceSettings,
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("elevenlabs tts failed:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ElevenLabs TTS request failed.",
      },
      { status: 502 },
    );
  }
}