import { uid } from "./projects.ts";

/**
 * Canonical scene file format for the Video Editor.
 *
 * A scene file is a JSON document describing the whole timeline:
 *
 *   { "version": 1, "brand": "#0d9488", "portrait": false, "scenes": [ … ] }
 *
 * Only `title` is required on a scene — every other field is optional and gets
 * a default, so a hand-written file can be as small as:
 *
 *   { "scenes": [ { "title": "The threshold" } ] }
 *
 * Text fields (`kicker`, `subtitle`, `narration`) default to empty rather than
 * to placeholder copy: the author writes the words. The UI shows a neutral
 * label while a field is empty, but nothing is written back into the scene.
 *
 * `group` is a plain label, and the same label may appear more than once — each
 * run of adjacent scenes sharing a label is its own section, which is what the
 * timeline draws a header for.
 *
 * `normalizeSceneDocument` is the single entry point: it repairs that partial
 * input instead of trusting it, and reports what it had to change so the UI can
 * tell the user rather than silently dropping data.
 */

export const SCENE_FORMAT_VERSION = 1;

export const DEFAULT_BRAND = "#0d9488";
export const DURATION_MIN = 1;
export const DURATION_MAX = 20;
export const DURATION_DEFAULT = 4;
/** ElevenLabs rejects longer texts; kept in sync with app/api/tts/route.ts. */
export const NARRATION_MAX = 5000;

export type Transition = "cut" | "fade" | "zoom" | "pan";

export const TRANSITIONS: readonly Transition[] = [
  "cut",
  "fade",
  "zoom",
  "pan",
];

export const ELEVEN_MODEL_IDS = {
  multilingual: "eleven_multilingual_v2",
  flash: "eleven_flash_v2_5",
  turbo: "eleven_turbo_v2_5",
} as const;

export const ELEVEN_MODEL_ID_LIST: readonly string[] = Object.values(
  ELEVEN_MODEL_IDS,
);

export const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
export const DEFAULT_MODEL_ID = ELEVEN_MODEL_IDS.multilingual;

export type SceneVoiceConfig = {
  voiceId: string;
  modelId: string;
  stability: number;
  similarity: number;
  style: number;
};

export type VideoScene = {
  id: string;
  /** Links the scene back to the chapter it was generated from, if any. */
  chapterId: string | null;
  /**
   * Section this scene belongs to, by label. Groups are contiguous runs in the
   * scene array rather than a nested structure, so ordering, drop targets and
   * the flat export all keep working unchanged.
   */
  group: string | null;
  kicker: string;
  title: string;
  subtitle: string;
  narration: string;
  /** Key into the app's image map (a file name), never a data URL. */
  imageKey: string | null;
  duration: number;
  transition: Transition;
  voice: SceneVoiceConfig;
};

export type SceneDocument = {
  version: number;
  brand: string;
  portrait: boolean;
  scenes: VideoScene[];
};

export function defaultVoiceConfig(
  overrides: Partial<SceneVoiceConfig> = {},
): SceneVoiceConfig {
  return {
    voiceId: DEFAULT_VOICE_ID,
    modelId: DEFAULT_MODEL_ID,
    stability: 0.5,
    similarity: 0.75,
    style: 0.3,
    ...overrides,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asText = (v: unknown, fallback: string): string =>
  typeof v === "string" ? v.trim() : fallback;

const asOptionalText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Accepts numbers and numeric strings so `"4.5"` survives hand-editing. */
const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Every voice control is a 0–1 slider in the UI and is clamped server-side too. */
const asUnit = (v: unknown, fallback: number): number => {
  const n = asNumber(v);
  return n === null ? fallback : clamp(n, 0, 1);
};

const isHexColor = (v: string): boolean =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

export type NormalizeOptions = {
  /** Keys in the current image map. When given, unknown imageKeys are cleared. */
  imageKeys?: readonly string[];
  /** Chapter ids in the active book, used to flag dangling chapter links. */
  chapterIds?: readonly string[];
  /** Injectable id factory, so tests can assert on deterministic ids. */
  newId?: () => string;
};

export function normalizeVoiceConfig(input: unknown): {
  voice: SceneVoiceConfig;
  warnings: string[];
} {
  const base = defaultVoiceConfig();
  if (!isRecord(input)) return { voice: base, warnings: [] };

  const warnings: string[] = [];
  const voiceId = asOptionalText(input.voiceId) ?? base.voiceId;
  const rawModelId = asOptionalText(input.modelId);
  const modelId =
    rawModelId && ELEVEN_MODEL_ID_LIST.includes(rawModelId)
      ? rawModelId
      : base.modelId;
  if (rawModelId && modelId !== rawModelId) {
    warnings.push(
      `unknown ElevenLabs model "${rawModelId}" — used ${base.modelId}`,
    );
  }

  return {
    voice: {
      voiceId,
      modelId,
      stability: asUnit(input.stability, base.stability),
      similarity: asUnit(input.similarity, base.similarity),
      style: asUnit(input.style, base.style),
    },
    warnings,
  };
}

/**
 * Repairs one scene. Returns `scene: null` (with a warning) only when the input
 * is not an object at all.
 *
 * A blank `title` is kept, not rejected: scenes are authored from blank
 * (see `DEFAULT_SCENE`), so an empty title is a legitimate authoring state and
 * dropping the scene here would make the per-scene JSON editor impossible to
 * round-trip on a brand new scene.
 */
export function normalizeScene(
  input: unknown,
  index: number,
  options: NormalizeOptions = {},
): { scene: VideoScene | null; warnings: string[] } {
  const label = `Scene ${index + 1}`;
  if (!isRecord(input)) {
    return { scene: null, warnings: [`${label} is not an object — skipped.`] };
  }

  const title = asText(input.title, "");

  const warnings: string[] = [];
  if (!title) {
    warnings.push(`${label} has no "title" — kept as a blank frame.`);
  }

  const rawTransition = asOptionalText(input.transition);
  let transition: Transition = "fade";
  if (rawTransition) {
    if ((TRANSITIONS as readonly string[]).includes(rawTransition)) {
      transition = rawTransition as Transition;
    } else {
      warnings.push(
        `unknown transition "${rawTransition}" — used "fade"`,
      );
    }
  }

  const rawDuration = asNumber(input.duration);
  let duration = DURATION_DEFAULT;
  if (rawDuration === null) {
    if (input.duration !== undefined) {
      warnings.push(
        `unreadable duration ${JSON.stringify(input.duration)} — used ${DURATION_DEFAULT}s`,
      );
    }
  } else if (rawDuration < DURATION_MIN || rawDuration > DURATION_MAX) {
    duration = round2(clamp(rawDuration, DURATION_MIN, DURATION_MAX));
    warnings.push(
      `duration ${rawDuration}s is outside ${DURATION_MIN}–${DURATION_MAX}s — clamped to ${duration}s`,
    );
  } else {
    duration = round2(rawDuration);
  }

  const narration =
    typeof input.narration === "string" ? input.narration.trim() : "";
  if (narration.length > NARRATION_MAX) {
    warnings.push(
      `narration is ${narration.length} chars — the TTS API rejects anything over ${NARRATION_MAX}`,
    );
  }

  let imageKey = asOptionalText(input.imageKey);
  if (imageKey && options.imageKeys && !options.imageKeys.includes(imageKey)) {
    warnings.push(`image "${imageKey}" is not in the current image map — cleared`);
    imageKey = null;
  }

  const chapterId = asOptionalText(input.chapterId);
  if (chapterId && options.chapterIds && !options.chapterIds.includes(chapterId)) {
    warnings.push(`chapterId "${chapterId}" matches no chapter in this book`);
  }

  const { voice, warnings: voiceWarnings } = normalizeVoiceConfig(input.voice);
  warnings.push(...voiceWarnings);

  return {
    scene: {
      id: asOptionalText(input.id) ?? (options.newId ?? (() => uid("scene-")))(),
      chapterId,
      group: asOptionalText(input.group),
      kicker: asText(input.kicker, ""),
      title,
      subtitle: asText(input.subtitle, ""),
      narration,
      imageKey,
      duration,
      transition,
      voice,
    },
    warnings: warnings.map((w) => `${label}: ${w}`),
  };
}

export function normalizeScenes(
  input: unknown,
  options: NormalizeOptions = {},
): { scenes: VideoScene[]; warnings: string[] } {
  if (!Array.isArray(input)) {
    return { scenes: [], warnings: ["`scenes` is not an array."] };
  }

  const scenes: VideoScene[] = [];
  const warnings: string[] = [];
  input.forEach((raw, index) => {
    const result = normalizeScene(raw, index, options);
    if (result.scene) scenes.push(result.scene);
    warnings.push(...result.warnings);
  });

  if (scenes.length === 0) warnings.push("No usable scenes found.");
  return { scenes, warnings };
}

/**
 * Accepts either a full document or a bare array of scenes, so the smallest
 * useful file is `[ { "title": "…" } ]`.
 */
export function normalizeSceneDocument(
  input: unknown,
  options: NormalizeOptions = {},
): { document: SceneDocument | null; warnings: string[] } {
  const raw = Array.isArray(input) ? { scenes: input } : input;
  if (!isRecord(raw)) {
    return {
      document: null,
      warnings: ["A scene file must be an object, or an array of scenes."],
    };
  }

  const { scenes, warnings } = normalizeScenes(raw.scenes, options);
  if (scenes.length === 0) return { document: null, warnings };

  const version = asNumber(raw.version);
  if (version !== null && version > SCENE_FORMAT_VERSION) {
    warnings.push(
      `file is v${version} but this build understands v${SCENE_FORMAT_VERSION} — unknown fields were ignored`,
    );
  }

  const rawBrand = asOptionalText(raw.brand);
  let brand = DEFAULT_BRAND;
  if (rawBrand) {
    if (isHexColor(rawBrand)) {
      brand = rawBrand;
    } else {
      warnings.push(`brand "${rawBrand}" is not a hex color — used ${DEFAULT_BRAND}`);
    }
  }

  return {
    document: {
      version: SCENE_FORMAT_VERSION,
      brand,
      portrait: raw.portrait === true,
      scenes,
    },
    warnings,
  };
}

/**
 * Reads the first scene out of a dropped file. The three shapes a person is
 * likely to produce are all accepted: a single scene object, an array, or a
 * full exported document. When the file holds more than one scene only the
 * first is used — dropping a whole timeline onto one clip is almost certainly
 * a mistake, and the caller is told how many were ignored.
 */
export function normalizeFirstScene(
  input: unknown,
  options: NormalizeOptions = {},
): { scene: VideoScene | null; totalScenes: number; warnings: string[] } {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.scenes)
      ? input.scenes
      : [input];

  const { scenes, warnings } = normalizeScenes(raw, options);
  const scene = scenes[0] ?? null;
  if (!scene) return { scene: null, totalScenes: 0, warnings };

  return {
    scene,
    totalScenes: scenes.length,
    warnings:
      scenes.length > 1
        ? [
            ...warnings,
            `file held ${scenes.length} scenes — only the first was applied`,
          ]
        : warnings,
  };
}
