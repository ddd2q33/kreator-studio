import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/align — word-level timestamps for a voice-over clip.
 *
 * Forwards the audio + its script to ElevenLabs' forced alignment and returns
 * the word timings it measured. This is what makes the burned-in subtitles
 * highlight each word exactly when it is spoken, instead of estimating from a
 * words-per-second rate.
 *
 * Body: multipart/form-data { file: audio, text: string }
 * Returns: { words: [{ text, start, end }], loss } — clip-relative seconds.
 *
 * The narration field is assumed to be the script that was actually recorded;
 * the aligner stretches the text over the real audio either way.
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "Expected multipart/form-data with a file and text." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const text = typeof form.get("text") === "string" ? (form.get("text") as string).trim() : "";
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Provide an audio file." }, { status: 400 });
  }
  if (!text) {
    return Response.json(
      { error: "Provide the narration text to align against." },
      { status: 400 },
    );
  }
  if (file.size > 100 * 1024 * 1024) {
    return Response.json(
      { error: "Audio file too large (max 100 MB)." },
      { status: 413 },
    );
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const result = await client.forcedAlignment.create({
      file,
      text,
    });
    const words: { text: string; start: number; end: number }[] = (
      result.words ?? []
    ).map((w: ElevenLabs.ForcedAlignmentWordResponseModel) => ({
      text: w.text,
      start: w.start,
      end: w.end,
    }));
    return Response.json(
      { words, loss: result.loss ?? 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("elevenlabs forced alignment failed:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Forced alignment request failed.",
      },
      { status: 502 },
    );
  }
}
