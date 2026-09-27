/**
 * Scene groups.
 *
 * A group is a label on a scene, not a container. The timeline stays a flat
 * array and a group is a run of adjacent scenes sharing a label, which is what
 * keeps reordering, drop targets and the PNG export working untouched.
 *
 * The same label can head two separate runs ("Intro" at the top, "Intro" again
 * later). Each run is its own section, because contiguity is what the timeline
 * draws separators for.
 */

export type SceneLike = { id: string; group: string | null; duration: number };

export type SceneRun<T extends SceneLike = SceneLike> = {
  /** Unique across the whole strip, and stable when earlier scenes change. */
  key: string;
  /** null for the run of scenes that belong to no group. */
  group: string | null;
  scenes: T[];
  /** Index of the first scene in the original array. */
  start: number;
  duration: number;
};

export const UNGROUPED_KEY = "ungrouped";

/**
 * Splits a flat scene list into contiguous same-label runs, in order.
 *
 * `key` carries an occurrence counter because one label can head two separate
 * sections, and two runs sharing a React key would let one section's collapsed
 * state leak into the other. The counter also keeps the key stable when scenes
 * are added or removed earlier in the timeline, which a raw index would not.
 */
export function sceneRuns<T extends SceneLike>(
  scenes: readonly T[],
): SceneRun<T>[] {
  const runs: SceneRun<T>[] = [];
  const seen = new Map<string, number>();
  let current: SceneRun<T> | null = null;

  scenes.forEach((scene, index) => {
    if (!current || current.group !== scene.group) {
      const label = scene.group ?? UNGROUPED_KEY;
      const occurrence = seen.get(label) ?? 0;
      seen.set(label, occurrence + 1);
      current = {
        key: `${label}#${occurrence}`,
        group: scene.group,
        scenes: [],
        start: index,
        duration: 0,
      };
      runs.push(current);
    }
    current.scenes.push(scene);
    current.duration += scene.duration;
  });

  return runs;
}

/** Every distinct label in use, in the order they first appear. */
export function groupLabels<T extends SceneLike>(scenes: readonly T[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const scene of scenes) {
    if (scene.group && !seen.has(scene.group)) {
      seen.add(scene.group);
      labels.push(scene.group);
    }
  }
  return labels;
}

/**
 * Whether a scene may shift one step in `dir` without leaving its run.
 *
 * Reordering has to respect run boundaries: a scene that hopped over the run
 * above would silently split one group in two, or merge two labels.
 */
export function canMoveWithinRun<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
  dir: -1 | 1,
): boolean {
  const index = scenes.findIndex((s) => s.id === id);
  if (index === -1) return false;
  const to = index + dir;
  if (to < 0 || to >= scenes.length) return false;
  return scenes[to]?.group === scenes[index]?.group;
}

/** The run a scene belongs to, or null when the id is unknown. */
export function runOfScene<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
): SceneRun<T> | null {
  for (const run of sceneRuns(scenes)) {
    if (run.scenes.some((s) => s.id === id)) return run;
  }
  return null;
}

/** Scene ids in a run, in order. Used by "dissolve group". */
export function runSceneIds<T extends SceneLike>(run: SceneRun<T>): string[] {
  return run.scenes.map((s) => s.id);
}

/** Human label for a run, used in headers and status messages. */
export function runLabel(run: SceneRun): string {
  return run.group ?? "Ungrouped";
}
