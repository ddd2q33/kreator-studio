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

/**
 * Whether dropping a scene at `to` would wedge it between two members of one
 * run.
 *
 * Moving a lone scene is only safe if its new neighbours are not the two halves
 * of a section that used to be whole. Comparing runs rather than labels is what
 * makes the difference: two *different* sections that happen to share a name are
 * a legitimate layout, and dropping something between them is the author's
 * call. Two scenes in the *same* run are one unit being cut in half.
 */
function wouldSplitRun<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
  to: number,
): boolean {
  const rest = scenes.filter((s) => s.id !== id);
  const left = rest[to - 1];
  const right = rest[to];
  if (!left || !right) return false;
  const run = runOfScene(scenes, left.id);
  if (!run || run.group === null) return false;
  return run.scenes.some((s) => s.id === right.id);
}

/**
 * Moves a scene one step up or down, carrying its whole section with it.
 *
 * A group is a run of adjacent scenes, not a container, so a scene that hops
 * over its own boundary would split one section into two — or, worse, weld a
 * stray scene into the middle of a section it has nothing to do with. Both
 * failures are invisible in the data and obvious on screen: the same section
 * name appears twice, and dragging one of them takes half of it away.
 *
 * So a scene inside a named group moves as part of that group, and a scene that
 * would land inside someone else's group does not move at all. Scenes with no
 * group move on their own, and that asymmetry is deliberate: ungrouped scenes
 * share a run purely for layout, so treating them as a unit would make every
 * reorder button shuffle the entire strip.
 *
 * Returns the input array unchanged when the move is impossible, so a caller
 * can use the identity to skip a state update and a re-render.
 */
export function moveSceneStep<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
  dir: -1 | 1,
): readonly T[] {
  const index = scenes.findIndex((s) => s.id === id);
  if (index === -1) return scenes;
  const to = index + dir;
  if (to < 0 || to >= scenes.length) return scenes;

  const run = runOfScene(scenes, id);
  const carries =
    run !== null && run.group !== null && run.scenes.length > 1 ? run : null;

  if (carries) {
    // The block swaps with the single scene on the far side, which belongs to a
    // different run by construction — that is what keeps the block contiguous.
    const from = carries.start;
    const blockTo = from + dir;
    if (blockTo < 0 || blockTo > scenes.length - carries.scenes.length) {
      return scenes;
    }
    const next = [...scenes];
    const block = next.splice(from, carries.scenes.length);
    next.splice(blockTo, 0, ...block);
    return next;
  }

  if (wouldSplitRun(scenes, id, to)) return scenes;

  const next = [...scenes];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The scenes of the run holding `id`, in timeline order.
 *
 * Returns the whole timeline when `id` is unknown, so a caller that lost the
 * selection exports everything rather than nothing: an empty video is a worse
 * answer than the full one.
 */
export function scenesOfRun<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
): readonly T[] {
  const run = runOfScene(scenes, id);
  return run ? run.scenes : scenes;
}

/**
 * Splits a scene in two at `at` seconds into it.
 *
 * The second half inherits everything the first one had - image, audio, group,
 * transition - because it is the same scene cut in half, not a new scene. The
 * one thing it does not inherit is the audio: a clip belongs to the scene the
 * author attached it to, and leaving it on both halves would play the same words
 * twice. The narration goes to the first half and the second starts blank, which
 * is the part that surprises people, so the caller says so out loud.
 *
 * Refuses when `at` would leave either half shorter than a usable frame; the
 * input array is returned unchanged so the caller can detect it by identity.
 */
export function splitScene<T extends SceneLike & { duration: number }>(
  scenes: readonly T[],
  id: string,
  at: number,
  minPart = 0.5,
  makeId: () => string = () => `scene-${Math.random().toString(36).slice(2)}`,
): readonly T[] {
  const index = scenes.findIndex((s) => s.id === id);
  if (index === -1) return scenes;
  const scene = scenes[index]!;
  const duration = Math.max(0, scene.duration);
  if (!(at >= minPart && at <= duration - minPart)) return scenes;

  const head: T = { ...scene, duration: at };
  const tail: T = { ...scene, id: makeId(), duration: duration - at };
  // The clip stays on the head, which plays it truncated to the head's length -
  // the same truncation the renderer already applies. The tail starts silent
  // rather than replaying the head's words, and the caller says so, because
  // slicing a stored clip in two is not something a key reference can do.
  const tailSilent = { ...tail, audio: null } as T;

  const next = [...scenes];
  next.splice(index, 1, head, tailSilent);
  return next;
}

/**
 * Moves the run holding `id` so it starts at `to`.
 *
 * This is the drag-and-drop move, and it is a different operation from
 * `moveSceneStep`: a drop names a *position*, not a direction. A drag has to
 * honour the same two rules the buttons do, and it is easier to state them as
 * one rule - the run travels as a block, and it lands between runs, never
 * inside one.
 *
 * Landing between runs means the block swaps with whichever runs sit in its way,
 * so `[A A, B B, C C]` dropping C at 0 gives `[C C, A A, B B]`: every run is
 * still whole, which is the only outcome a reader of the timeline can interpret.
 *
 * `to` is an index in the *original* list, so a drop near the end lands after
 * the last run rather than short of it. Returns the input when the drop is a
 * no-op, so the caller can skip the state update.
 */
export function moveRunTo<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
  to: number,
): readonly T[] {
  const runs = sceneRuns(scenes);
  const mine = runs.findIndex((r) => r.scenes.some((s) => s.id === id));
  if (mine === -1) return scenes;

  const mineRun = runs[mine]!;
  const target = Math.max(0, Math.min(to, scenes.length));
  // A drop on the card the author picked up is a no-op, not a refused move.
  if (target === mineRun.start || target === mineRun.start + mineRun.scenes.length) {
    return scenes;
  }

  const others = runs.filter((_, i) => i !== mine);
  const inRun = new Set(mineRun.scenes.map((s) => s.id));
  // How many surviving scenes precede the drop. This is what turns a scene index
  // into a position between runs, which is the only kind of position a run can
  // legally occupy.
  const before = scenes.slice(0, target).filter((s) => !inRun.has(s.id)).length;

  let acc = 0;
  let at = others.length;
  for (let i = 0; i < others.length; i++) {
    if (acc >= before) {
      at = i;
      break;
    }
    acc += others[i]!.scenes.length;
    at = i + 1;
  }

  return [
    ...others.slice(0, at).flatMap((r) => r.scenes),
    ...mineRun.scenes,
    ...others.slice(at).flatMap((r) => r.scenes),
  ];
}

/**
 * A filename-safe suffix naming the run holding `id`, or "" when the whole
 * timeline is being exported.
 *
 * Without this a section export lands in the downloads as `promo.mp4`,
 * indistinguishable from the full cut, and the second one overwrites it.
 */
export function sectionSlug<T extends SceneLike>(
  scenes: readonly T[],
  id: string | null,
): string {
  if (!id) return "";
  const run = runOfScene(scenes, id);
  const label = run?.group;
  if (!label) return "";
  const slug = label
    .normalize("NFD")
    // Drop the accents so the name survives a filesystem that only takes ASCII.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `-${slug}` : "";
}

/** Whether `moveSceneStep` would actually change anything. */
export function canMoveSceneStep<T extends SceneLike>(
  scenes: readonly T[],
  id: string,
  dir: -1 | 1,
): boolean {
  return moveSceneStep(scenes, id, dir) !== scenes;
}

/** Human label for a run, used in headers and status messages. */
export function runLabel(run: SceneRun): string {
  return run.group ?? "Ungrouped";
}
