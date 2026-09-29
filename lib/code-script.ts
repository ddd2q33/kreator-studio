/**
 * Reading and writing a code video as a script.
 *
 * The editor is a generator, so the script is the source of truth: this is how a
 * video is written down, handed to somebody else to shoot, regenerated after a
 * change, and version-controlled next to the code it explains. A whole video is
 * one JSON document:
 *
 *   {
 *     "format": "phone-vertical",
 *     "scenes": [
 *       {
 *         "title": "The bug",
 *         "language": "python",
 *         "file": "app.py",
 *         "code": "def total(xs):\n    return sum(xs)",
 *         "subscenes": [
 *           { "note": "here it is", "duration": 2.5, "lines": [0, 1] },
 *           { "note": "why it breaks", "duration": 3, "lines": [1], "highlight": [0] }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Only `title` is required on a scene and nothing is required on a sub-scene
 * beyond what it needs to say, so the smallest useful file is still a video:
 *
 *   { "scenes": [ { "title": "The bug", "code": "…" } ] }
 *
 * Three conveniences, all of them aimed at writing this by hand rather than
 * generating it:
 *
 * - `lines` takes `3-8`, `"3,5,9"` or `[3, 5, 9]`, because nobody counts line
 *   indices out loud correctly and a script full of `[2, 3, 4, 5, 6, 7]` is a
 *   worse thing to edit than a range.
 * - `subscenes`, `beats` and `steps` are the same key, because a script is called
 *   all three things depending on who wrote it.
 * - A sub-scene that carries its own `code` starts a new scene. Explaining a
 *   concept usually means showing the same function before and after, and having
 *   to cut a script in half and re-join the parts by hand is the wrong tool for
 *   that.
 *
 * `parseCodeScript` never trusts the input. Everything here arrives from a
 * textarea, so a duration of nine hours and a line index of 40000 are both
 * expected, and each one is repaired and reported rather than allowed to stop the
 * video from rendering.
 */

import {
  BEATS_MAX,
  BEAT_DEFAULT,
  BEAT_MAX,
  BEAT_MIN,
  CAPTION_MAX,
  CODE_MAX_CHARS,
  CODE_SCRIPT_VERSION_LOCAL,
  FILENAME_MAX,
  NOTE_MAX,
  SCENES_MAX,
  TITLE_MAX,
  formatById,
  newBeat,
  newScene,
  revealById,
  styleById,
  type CodeBeat,
  type CodeProject,
  type CodeScene,
} from "./code-art.ts";

export const CODE_SCRIPT_VERSION = CODE_SCRIPT_VERSION_LOCAL;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asOptionalText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
};

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Reads a line selection written as a list, a range, or a comma-separated string.
 *
 * Ranges are 0-based like everything else in this model, and they are inclusive
 * at both ends, so `"3-8"` is the seven lines a person counts from 3 to 8. A
 * backwards range (`"8-3"`) is read as written rather than reordered: a script
 * that asks for 8 then 3 wants 8 then 3, and every scene is allowed to show its
 * lines out of file order.
 */
export function parseLineList(value: unknown, total: number): { lines: number[]; warnings: string[] } {
  const warnings: string[] = [];
  if (value === undefined || value === null) return { lines: [], warnings };

  const out: number[] = [];
  const add = (n: number) => {
    if (!Number.isInteger(n)) {
      warnings.push(`line ${n} is not a whole number — dropped`);
      return;
    }
    if (n < 0) {
      warnings.push(`line ${n} is negative — dropped`);
      return;
    }
    if (total > 0 && n >= total) {
      // Said out loud rather than clamped: a sub-scene pointing past the end of
      // the file is nearly always a stale index, and silently drawing the last
      // line instead is how a tutorial ends up teaching the wrong code.
      warnings.push(`line ${n} is past the end of a ${total}-line file — dropped`);
      return;
    }
    if (!out.includes(n)) out.push(n);
  };

  const items: unknown[] = Array.isArray(value)
    ? value.flatMap((entry) =>
        typeof entry === "string" ? entry.split(/[,\s]+/).filter(Boolean) : [entry],
      )
    : typeof value === "string"
      ? value.split(/[,\s]+/).filter(Boolean)
      : [value];

  for (const item of items) {
    if (typeof item === "number") {
      add(item);
      continue;
    }
    if (typeof item !== "string") {
      warnings.push(`${JSON.stringify(item)} is not a line number — dropped`);
      continue;
    }
    const range = /^(\d+)\s*(?:-|\.\.|:|\.\.)\s*(\d+)$/.exec(item.trim());
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const step = from <= to ? 1 : -1;
      for (let n = from; step > 0 ? n <= to : n >= to; n += step) add(n);
      continue;
    }
    const n = asNumber(item);
    if (n === null) {
      warnings.push(`"${item}" is not a line number or a range — dropped`);
      continue;
    }
    add(n);
  }
  return { lines: out, warnings };
}

/** The keys a sub-scene may be written under, in the order they are looked for. */
const SUBCENE_KEYS = ["subscenes", "beats", "steps", "scenes"] as const;
const BEAT_LINES_KEYS = ["lines", "line", "show"] as const;
const BEAT_MARKS_KEYS = ["highlight", "highlights", "marks", "mark"] as const;

/** Everything a scene or a sub-scene may set, read once so both can use it. */
type BodyInput = Record<string, unknown>;

function readBody(input: BodyInput, total: number, label: string) {
  const warnings: string[] = [];
  const code = typeof input.code === "string" ? input.code.replace(/\r\n?/g, "\n").slice(0, CODE_MAX_CHARS) : null;
  const linesTotal = code ? code.split("\n").length : total;

  const rawLines = BEAT_LINES_KEYS.map((k) => input[k]).find((v) => v !== undefined);
  const { lines, warnings: lineWarnings } = parseLineList(rawLines, linesTotal);
  warnings.push(...lineWarnings);

  const rawMarks = BEAT_MARKS_KEYS.map((k) => input[k]).find((v) => v !== undefined);
  // Marks are positions within the lines above, not file line numbers, so they
  // are bounded by however many lines this sub-scene actually shows.
  const { lines: marks, warnings: markWarnings } = parseLineList(
    rawMarks,
    lines.length > 0 ? lines.length : linesTotal,
  );
  warnings.push(...markWarnings);

  const rawDuration = asNumber(input.duration ?? input.seconds ?? input.for);
  let duration = BEAT_DEFAULT;
  if (rawDuration === null) {
    if (input.duration !== undefined) {
      warnings.push(`${label}: unreadable duration — used ${BEAT_DEFAULT}s`);
    }
  } else if (rawDuration < BEAT_MIN || rawDuration > BEAT_MAX) {
    duration = clamp(rawDuration, BEAT_MIN, BEAT_MAX);
    warnings.push(
      `${label}: duration ${rawDuration}s is outside ${BEAT_MIN}–${BEAT_MAX}s — clamped to ${duration}s`,
    );
  } else {
    duration = rawDuration;
  }

  return {
    code,
    language: asOptionalText(input.language, 40),
    fileName: asOptionalText(input.fileName ?? input.file, FILENAME_MAX),
    title: asOptionalText(input.title, TITLE_MAX),
    caption: asOptionalText(input.caption ?? input.subtitle, CAPTION_MAX),
    note: asOptionalText(input.note ?? input.label ?? input.beat, NOTE_MAX) ?? "",
    lines,
    marks,
    duration,
    warnings,
  };
}

function makeBeat(
  input: unknown,
  fallback: { code: string; language: string; total: number },
  index: number,
  warnings: string[],
): CodeBeat {
  if (!isRecord(input)) {
    warnings.push(`sub-scene ${index + 1} is not an object — skipped`);
    return newBeat([], BEAT_DEFAULT);
  }
  const label = `sub-scene ${index + 1}`;
  const body = readBody(input, fallback.total, label);
  warnings.push(...body.warnings);
  const total = body.code ? body.code.split("\n").length : fallback.total;
  // No `lines` at all means "the whole file", which is what somebody writing one
  // sub-scene for a scene means by leaving it empty.
  const lines =
    BEAT_LINES_KEYS.some((k) => input[k] !== undefined) || body.code
      ? body.lines
      : Array.from({ length: total }, (_, i) => i);
  return {
    id: `beat_${index}`,
    note: body.note,
    lines,
    marks: body.marks,
    duration: body.duration,
  };
}

/**
 * Turns one authored scene into the scenes it really is.
 *
 * More than one comes out when the sub-scenes disagree about the file, because
 * a sub-scene that carries its own `code` is showing a different file and cannot
 * live inside a scene that owns one. Grouping is by file, so a script that shows
 * `before` in three sub-scenes and `after` in two comes back as two scenes in the
 * order they were written, not as five.
 */
function scenesFromOne(
  input: BodyInput,
  index: number,
  warnings: string[],
): CodeScene[] {
  const label = `Scene ${index + 1}`;
  const ownCode = typeof input.code === "string" ? input.code.replace(/\r\n?/g, "\n").slice(0, CODE_MAX_CHARS) : null;
  const rawBeats = SUBCENE_KEYS.map((k) => input[k]).find((v) => Array.isArray(v)) as
    | unknown[]
    | undefined;

  if (!rawBeats || rawBeats.length === 0) {
    // No sub-scenes: the whole file plays as one, which is a legitimate script.
    const scene = newScene(ownCode ?? "", asOptionalText(input.language, 40) ?? "text", asOptionalText(input.fileName ?? input.file, FILENAME_MAX) ?? "code");
    scene.title = asOptionalText(input.title, TITLE_MAX) ?? "";
    scene.caption = asOptionalText(input.caption ?? input.subtitle, CAPTION_MAX) ?? "";
    if (ownCode) scene.beats = [newBeat(Array.from({ length: ownCode.split("\n").length }, (_, n) => n))];
    const hold = asNumber(input.hold);
    if (hold !== null) scene.hold = hold;
    return [scene];
  }

  const defaults = {
    code: ownCode ?? "",
    language: asOptionalText(input.language, 40) ?? "text",
    fileName: asOptionalText(input.fileName ?? input.file, FILENAME_MAX) ?? "code",
    total: ownCode ? ownCode.split("\n").length : 0,
  };

  // Group the sub-scenes by the file they show, keeping first-seen order.
  const groups: { code: string; language: string; fileName: string; beats: CodeBeat[]; titles: (string | null)[]; captions: (string | null)[] }[] = [];
  rawBeats.slice(0, BEATS_MAX).forEach((raw, i) => {
    if (!isRecord(raw)) {
      warnings.push(`${label}: sub-scene ${i + 1} is not an object — skipped`);
      return;
    }
    const beatCode = typeof raw.code === "string" ? raw.code.replace(/\r\n?/g, "\n").slice(0, CODE_MAX_CHARS) : null;
    const code = beatCode ?? defaults.code;
    const language = asOptionalText(raw.language, 40) ?? defaults.language;
    const fileName = asOptionalText(raw.fileName ?? raw.file, FILENAME_MAX) ?? defaults.fileName;
    const beat = makeBeat(raw, { code: defaults.code, language: defaults.language, total: defaults.total }, i, warnings);
    const existing = groups.find((g) => g.code === code && g.language === language);
    if (existing) {
      existing.beats.push(beat);
      existing.titles.push(asOptionalText(raw.title, TITLE_MAX));
      existing.captions.push(asOptionalText(raw.caption ?? raw.subtitle, CAPTION_MAX));
    } else {
      groups.push({
        code,
        language,
        fileName,
        beats: [beat],
        titles: [asOptionalText(raw.title, TITLE_MAX)],
        captions: [asOptionalText(raw.caption ?? raw.subtitle, CAPTION_MAX)],
      });
    }
  });

  if (groups.length === 0) {
    warnings.push(`${label}: no usable sub-scenes — skipped`);
    return [];
  }

  const out: CodeScene[] = [];
  groups.forEach((group, gi) => {
    const scene = newScene(group.code, group.language, group.fileName);
    scene.beats = group.beats;
    // The scene's own title goes on the first group; a sub-scene's own title or
    // caption is promoted to the scene when the script did not name the scene,
    // which is how a two-file "before/after" script ends up with both halves
    // labelled instead of only the first.
    const groupTitle = gi === 0 ? asOptionalText(input.title, TITLE_MAX) : null;
    scene.title = groupTitle ?? group.titles.find((t) => t) ?? "";
    scene.caption =
      (gi === 0 ? asOptionalText(input.caption ?? input.subtitle, CAPTION_MAX) : null) ??
      group.captions.find((c) => c) ??
      "";
    const hold = asNumber(input.hold);
    if (hold !== null) scene.hold = hold;
    const speed = asNumber(input.speed);
    if (speed !== null) scene.speed = speed;
    out.push(scene);
  });

  if (groups.length > 1) {
    warnings.push(
      `${label}: sub-scenes show ${groups.length} different files — split into ${groups.length} scenes`,
    );
  }
  return out;
}

export type ParseResult = {
  /** The settings the script asked for, or null for the defaults. */
  settings: Partial<CodeProject> | null;
  scenes: CodeScene[];
  warnings: string[];
};

/**
 * Reads a script into scenes.
 *
 * Accepts the three shapes a person is likely to paste: a whole document, an
 * array of scenes, or a single scene. The difference decides how much of the
 * existing timeline is replaced, so it is resolved here rather than in the
 * component, where nothing could test it.
 */
export function parseCodeScript(input: unknown): ParseResult {
  const warnings: string[] = [];

  if (Array.isArray(input)) {
    const scenes = input
      .slice(0, SCENES_MAX)
      .flatMap((raw, i) => (isRecord(raw) ? scenesFromOne(raw, i, warnings) : []));
    return { settings: null, scenes, warnings };
  }
  if (!isRecord(input)) {
    return { settings: null, scenes: [], warnings: ["A script must be a JSON object or an array of scenes."] };
  }

  const rawScenes = Array.isArray(input.scenes) ? input.scenes : null;
  const oneScene = SUBCENE_KEYS.some((k) => Array.isArray(input[k]));
  const list: unknown[] = rawScenes ?? (oneScene ? [input] : [input]);

  const scenes = list
    .slice(0, SCENES_MAX)
    .flatMap((raw, i) => (isRecord(raw) ? scenesFromOne(raw, i, warnings) : []));

  const settings: Partial<CodeProject> = {};
  const styleId = asOptionalText(input.style ?? input.styleId, 40);
  if (styleId) {
    if (styleById(styleId).id !== styleId) {
      warnings.push(`unknown style "${styleId}" — used "${styleById(styleId).id}"`);
    }
    settings.styleId = styleById(styleId).id;
  }
  const formatId = asOptionalText(input.format ?? input.formatId, 40);
  if (formatId) {
    if (formatById(formatId).id !== formatId) {
      warnings.push(`unknown format "${formatId}" — used "${formatById(formatId).id}"`);
    }
    settings.formatId = formatById(formatId).id;
  }
  const reveal = asOptionalText(input.reveal, 40);
  if (reveal) settings.reveal = revealById(reveal);
  const name = asOptionalText(input.name, 80);
  if (name) settings.name = name;
  const speed = asNumber(input.speed);
  if (speed !== null) settings.speed = speed;
  if (typeof input.cursor === "boolean") settings.cursor = input.cursor;
  if (typeof input.captions === "boolean") settings.captions = input.captions;
  if (typeof input.notes === "boolean") settings.notes = input.notes;

  return { settings: Object.keys(settings).length > 0 ? settings : null, scenes, warnings };
}

/**
 * Parses JSON text.
 *
 * The error is returned rather than thrown: this is called from a textarea, and
 * the caller needs to show "line 12: unexpected }" next to the text rather than
 * lose it.
 */
export function parseCodeScriptText(text: string): ParseResult & { error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { settings: null, scenes: [], warnings: [], error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return {
      settings: null,
      scenes: [],
      warnings: [],
      error: error instanceof Error ? error.message : "That is not valid JSON.",
    };
  }
  return { ...parseCodeScript(parsed), error: null };
}

/**
 * The project's script, as JSON text ready to paste somewhere.
 *
 * Written back in the authoring shape rather than the internal one, so a round
 * trip through this function and `parseCodeScriptText` is a no-op - which is the
 * only way to trust an export button. `subscenes` is the key it was written with
 * and `lines` stays a list, because both are what a person editing the file
 * expects to find.
 */
export function serializeCodeScript(project: CodeProject): string {
  const format = formatById(project.formatId);
  const doc: Record<string, unknown> = {
    version: CODE_SCRIPT_VERSION,
    name: project.name,
    style: project.styleId,
    format: format.id,
    reveal: project.reveal,
    speed: project.speed,
    cursor: project.cursor,
    captions: project.captions,
    notes: project.notes,
    scenes: project.scenes.map((scene) => ({
      title: scene.title || undefined,
      caption: scene.caption || undefined,
      file: scene.fileName || undefined,
      language: scene.language,
      code: scene.code,
      hold: Number.isFinite(scene.hold) ? scene.hold : undefined,
      speed: scene.speed ?? undefined,
      subscenes: scene.beats.map((beat) => ({
        note: beat.note || undefined,
        duration: beat.duration,
        lines: beat.lines,
        highlight: beat.marks.length > 0 ? beat.marks : undefined,
      })),
    })),
  };
  return JSON.stringify(doc, null, 2);
}

/**
 * The plain-text outline, for reading the script without reading the code.
 *
 * One line per sub-scene, with its length, so a person can check the running
 * time and the order of an explanation in one glance. This is the thing to
 * paste into a review, because the JSON is unreadable and the timings are the
 * part that actually needs a second pair of eyes.
 */
export function outlineCodeScript(project: CodeProject): string {
  const out: string[] = [];
  let at = 0;
  project.scenes.forEach((scene, i) => {
    const playable = scene.beats.filter((b) => b.lines.length > 0);
    if (playable.length === 0) return;
    out.push(
      `${String(i + 1).padStart(2, " ")}. ${scene.title || "Untitled scene"}  [${scene.fileName || scene.language}]`,
    );
    scene.beats.forEach((beat) => {
      const seconds = Math.round(beat.duration * 10) / 10;
      const time = formatClock(at);
      at += seconds;
      if (beat.lines.length === 0) {
        out.push(`      (empty) ${beat.note}`.trimEnd());
        return;
      }
      out.push(
        `      ${time}  ${seconds}s  lines ${describeLines(beat)}  ${beat.note || ""}`.trimEnd(),
      );
    });
    // The scene's own hold is on the timeline too, so the outline has to count it
    // or the times after the first scene are all wrong.
    at += Math.round(scene.hold * 10) / 10;
  });
  out.push("");
  out.push(`Total ${formatClock(at)}`);
  return out.join("\n");
}

function describeLines(beat: CodeBeat): string {
  if (beat.lines.length === 0) return "—";
  // Collapsed into ranges when they are contiguous, because a sub-scene that
  // shows lines 3 to 9 should read as "3-9" and not as nine numbers.
  const sorted = [...beat.lines].sort((a, b) => a - b);
  const parts: string[] = [];
  let from = sorted[0]!;
  let to = sorted[0]!;
  for (const n of sorted.slice(1)) {
    if (n === to + 1) {
      to = n;
      continue;
    }
    parts.push(from === to ? `${from + 1}` : `${from + 1}-${to + 1}`);
    from = to = n;
  }
  parts.push(from === to ? `${from + 1}` : `${from + 1}-${to + 1}`);
  return parts.join(", ");
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
