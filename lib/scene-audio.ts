/**
 * Pure helpers for the audio a scene carries.
 *
 * Kept free of DOM and IndexedDB so the rules that are easy to get wrong - how
 * long a scene becomes when its audio is longer, and where every clip lands on
 * the export timeline - can be tested directly. The browser-only parts
 * (measuring a File, decoding it) live in the component.
 */

/** Extensions accepted on drop. The MIME check in `isAudioFile` covers the rest. */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "flac",
  "aiff",
  "aif",
  "weba",
] as const;

export const AUDIO_ACCEPT = `audio/*,${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",")}`;

/** True for anything the editor will accept as a scene's voice-over. */
export function isAudioFile(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith("audio/")) return true;
  // `.ogg` and `.webm` are containers for both, so an explicit video/* type
  // wins over the extension and the file still goes to the video splitter.
  if (file.type?.startsWith("video/")) return false;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = file.name.slice(dot + 1).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** A clip small enough to keep in IndexedDB and mix in a browser. */
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** Bounds the editor already enforces on scene length. */
export const MIN_SCENE_DURATION = 1;
export const MAX_SCENE_DURATION = 20;

/**
 * The duration a scene should take once `audioDuration` seconds land on it.
 *
 * A clip longer than the scene gets the scene stretched rather than cut off,
 * because a truncated voice-over is the one failure the viewer always notices.
 * A shorter clip leaves the duration alone: the user may have set it for pacing
 * or to leave room for the next scene's audio.
 */
export function targetSceneDuration(
  current: number,
  audioDuration: number,
): number {
  if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
    return clampDuration(current);
  }
  return clampDuration(Math.max(current, audioDuration));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return MIN_SCENE_DURATION;
  return Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, value));
}

/** One clip's place on the finished timeline. */
export type AudioSlot = {
  /** Index of the scene that owns the clip. */
  sceneIndex: number;
  /** Clip key as stored in IndexedDB. */
  key: string;
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds to play; the scene's own length. */
  duration: number;
  /** Seconds to skip into the file, for a clip longer than its scene. */
  offset: number;
  /**
   * Linear gain from the owning scene, already clamped to 0..1.
   *
   * Kept on the slot rather than read from the scene at mix time because the
   * mix walks slots, and a mute is expressed as gain 0 here so the scheduler and
   * the mixer cannot disagree about which clips are silent.
   */
  gain: number;
};

/**
 * Lays every scene's clip onto the shared timeline.
 *
 * A clip longer than its scene keeps its opening words and loses its tail,
 * matching the rule in `targetSceneDuration` that scenes grow to fit their
 * audio rather than the other way around.
 *
 * A muted scene still produces a slot when it has audio, at gain 0. Dropping the
 * slot instead would renumber nothing but would make the mixer unable to tell a
 * deliberate silence from a scene with no clip, which is the difference between
 * "muted" and "empty" in the export.
 */
export function buildAudioSchedule(
  scenes: readonly {
    audio: { key: string; duration: number } | null;
    duration: number;
    volume?: number;
    muted?: boolean;
  }[],
  fromTime = 0,
): AudioSlot[] {
  const slots: AudioSlot[] = [];
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneDuration = Math.max(0, scene.duration);
    if (scene.audio && scene.audio.duration > 0) {
      const available = Math.min(sceneDuration, scene.audio.duration);
      slots.push({
        sceneIndex: i,
        key: scene.audio.key,
        start: acc,
        duration: available,
        offset: 0,
        gain: scene.muted ? 0 : clampGain(scene.volume),
      });
    }
    acc += sceneDuration;
  }
  // Dropping the export at a later point only makes sense once the playhead is
  // past a clip's start; anything already behind the playhead is skipped whole.
  if (fromTime > 0) {
    return slots.filter((slot) => slot.start + slot.duration > fromTime);
  }
  return slots;
}

function clampGain(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Total length of a scene list, in seconds. */
export function scenesDuration(
  scenes: readonly { duration: number }[],
): number {
  return scenes.reduce((acc, s) => acc + Math.max(0, s.duration), 0);
}

/** Formats seconds as `m:ss`, used next to the clip name. */
export function formatAudioDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
