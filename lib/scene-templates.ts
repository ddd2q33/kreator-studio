/**
 * Ready-made JSON for the Scene JSON editor.
 *
 * The editor accepts three different shapes and nothing on screen says which is
 * which, so the fastest way to learn the format is to paste a working example
 * and edit it. These are the shapes the importer actually accepts, kept in one
 * place so the picker and the documentation cannot drift apart.
 *
 * Every template is a real, valid document: `scene-templates.test.ts` runs all
 * of them through `normalizeSceneDocument` and fails if one produces warnings or
 * no scenes. A template that does not import is worse than no template, because
 * the author has no way to tell their own mistake from the example's.
 */

export type SceneJsonTemplate = {
  /** Stable key for the picker. */
  id: string;
  /** Short name shown in the dropdown. */
  label: string;
  /** One line explaining when to reach for this shape. */
  hint: string;
  /** The example, pretty-printed for reading in a textarea. */
  json: string;
};

const single = {
  title: "The opening line",
  subtitle: "A short line under the title",
  narration: "She read the message twice before she understood it.",
  duration: 4,
  transition: "fade",
};

const section = {
  scene: "The Silence",
  kicker: "ACT ONE",
  subscenes: [
    {
      narration: "She checked her phone again.",
      duration: 2,
      transition: "fade",
    },
    {
      narration: "Again. Still nothing.",
      duration: 2,
      transition: "fade",
    },
    {
      narration: "But silence felt louder than words.",
      duration: 3,
      transition: "fade",
    },
  ],
};

const episode = {
  episode: "She Thought She Was Too Needy",
  scenes: [
    section,
    {
      scene: "The Message",
      subscenes: [
        { narration: "Then finally...", duration: 2, transition: "fade" },
        { narration: "A message appeared.", duration: 2, transition: "fade" },
        {
          narration: "Sorry. Long day. Going to sleep. Goodnight.",
          duration: 4,
          transition: "fade",
        },
        { narration: "For a moment, she felt safe.", duration: 3, transition: "fade" },
      ],
    },
    {
      scene: "Understanding",
      subscenes: [
        {
          narration: "Healing doesn't begin by forcing yourself to stop feeling.",
          duration: 5,
          transition: "fade",
        },
        {
          narration: "It begins by understanding why you feel this way.",
          duration: 5,
          transition: "fade",
        },
      ],
    },
  ],
};

const media = {
  title: "Scene with media",
  narration: "This scene carries its own image and voice-over clip.",
  // Image keys come from the editor's image pool; an unknown one is cleared on
  // apply, which is why the placeholder below is meant to be replaced.
  imageKey: "img-replace-me",
  audio: {
    key: "clip-replace-me",
    name: "voiceover.wav",
    duration: 4,
    bytes: 0,
    type: "audio/wav",
  },
  duration: 4,
  transition: "fade",
};

/**
 * A whole exported project, exactly the shape "Export JSON" writes: document
 * settings up top, scenes below. This is the format to paste back if the file
 * came from this editor, and the only way to set the canvas to portrait or to
 * pick the subtitle style for the whole timeline in one go.
 */
const portraitVideo = {
  version: 1,
  brand: "#0d9488",
  portrait: true,
  subtitleStyleId: "reels",
  scenes: [
    {
      kicker: "REELS",
      title: "A portrait short",
      subtitle: "9:16 canvas, subtitles at the bottom",
      narration: "Portrait shorts are made for watching with the sound off.",
      duration: 3,
      transition: "cut",
    },
    {
      title: "Second beat",
      subtitle: "Keep it under a minute",
      narration: "That means the captions carry most of the story.",
      duration: 4,
      transition: "cut",
    },
  ],
};

/**
 * Every optional field a single scene can carry, in one object, so the author
 * can see the whole vocabulary before reaching for the small examples.
 */
const allFields = {
  id: "hand-written-scene",
  chapterId: null,
  group: "Reference",
  kicker: "REFERENCE",
  title: "Every field",
  subtitle: "kicker, title, subtitle and narration are the text layers",
  narration: "imageFit chooses how the picture fills the 16:9 frame.",
  imageKey: "img-replace-me",
  imageFit: "cover",
  duration: 6,
  transition: "zoom",
  volume: 0.85,
  muted: false,
  audio: {
    key: "clip-replace-me",
    name: "voiceover.wav",
    duration: 4,
    bytes: 0,
    type: "audio/wav",
    regions: [
      { start: 0.2, end: 2.1 },
      { start: 2.6, end: 3.9 },
    ],
  },
  code: {
    language: "typescript",
    source: "const theme = palette(project.brand);",
    theme: "midnight",
    reveal: "typed",
    scale: 1.2,
  },
  notes: "Editor-only scratchpad: never spoken and never exported.",
};

/**
 * A teaching section: every subscene carries a snippet, so applying this drops
 * a run of code frames into the timeline instead of a run of title cards.
 *
 * `code` is read per subscene, not from the group, so a grouped template has to
 * repeat it. The fields are the ones that warn when wrong: `reveal` outside
 * all/typed/lines, a `scale` outside 0.4-2, or a source over 8000 characters
 * all fail the template test, which is why these stay inside the limits.
 */
const lesson = {
  scene: "How a memo cache works",
  kicker: "LESSON 01",
  subscenes: [
    {
      narration: "A memo cache remembers what it already computed.",
      duration: 3,
      transition: "fade",
    },
    {
      narration: "Here is the whole idea: look it up, compute it only if it is missing.",
      duration: 5,
      transition: "fade",
      code: {
        language: "typescript",
        source: [
          "function memo<T>(compute: (n: number) => T) {",
          "  const cache = new Map<number, T>();",
          "  return (n: number): T => {",
          "    if (cache.has(n)) return cache.get(n)!;",
          "    const value = compute(n);",
          "    cache.set(n, value);",
          "    return value;",
          "  };",
          "}",
        ].join("\n"),
        theme: "midnight",
        reveal: "lines",
        scale: 1,
      },
    },
    {
      narration: "The cache lookup is the entire optimisation.",
      duration: 4,
      transition: "fade",
      code: {
        language: "typescript",
        source: "if (cache.has(n)) return cache.get(n)!;",
        theme: "midnight",
        reveal: "typed",
        scale: 1.15,
        callouts: {},
        focus: [],
      },
    },
    {
      narration: "Type it out character by character for the trick, and show it whole for the result.",
      duration: 4,
      transition: "fade",
      code: {
        language: "python",
        source: ["@lru_cache(maxsize=None)", "def fib(n):", "    return n if n < 2 else fib(n - 1) + fib(n - 2)"].join(
          "\n",
        ),
        theme: "paper",
        reveal: "all",
        scale: 1,
        // The teaching beat: line 2 is the line the narration is about, so it
        // is spotlighted and named while the rest of the snippet steps back.
        callouts: { 2: "caches results" },
        focus: [2],
      },
    },
    {
      narration: "Now try it on your own code.",
      duration: 3,
      transition: "fade",
    },
  ],
};

/**
 * The full set, in the order the picker shows them: simplest first, so the
 * first three options cover every shape and the rest are reference material —
 * a full project file, one scene with every field, one with media, and one
 * with every transition.
 */
export const SCENE_JSON_TEMPLATES: readonly SceneJsonTemplate[] = [
  {
    id: "scene",
    label: "One scene",
    hint: "A single frame. Replaces the selected scene.",
    json: JSON.stringify(single, null, 2),
  },
  {
    id: "section",
    label: "Section with subscenes",
    hint: "One named section that becomes a run of scenes.",
    json: JSON.stringify(section, null, 2),
  },
  {
    id: "programming",
    label: "Programming lesson",
    hint: "A run of code frames, one snippet per scene.",
    json: JSON.stringify(lesson, null, 2),
  },
  {
    id: "episode",
    label: "Whole episode",
    hint: "Many sections at once. Appended to the timeline.",
    json: JSON.stringify(episode, null, 2),
  },
  {
    id: "portrait",
    label: "Portrait short",
    hint: "Full exported project: 9:16 canvas, caption style, scenes.",
    json: JSON.stringify(portraitVideo, null, 2),
  },
  {
    id: "all-fields",
    label: "Scene with every field",
    hint: "One scene showing every optional field at once.",
    json: JSON.stringify(allFields, null, 2),
  },
  {
    id: "media",
    label: "Scene with image and audio",
    hint: "Attach a pooled image and a stored voice-over clip.",
    json: JSON.stringify(media, null, 2),
  },
  {
    id: "transitions",
    label: "Every transition",
    hint: "One scene per transition, so you can see each one.",
    json: JSON.stringify(
      {
        scene: "Transitions",
        kicker: "REFERENCE",
        // transition describes how a scene arrives, so each value needs its own
        // subscene to be visible.
        subscenes: [
          {
            narration: "fade - crossfade centred on the cut.",
            duration: 2,
            transition: "fade",
          },
          {
            narration: "cut - hard cut, no blend.",
            duration: 2,
            transition: "cut",
          },
          {
            narration: "zoom - a slow push painted inside the scene.",
            duration: 2,
            transition: "zoom",
          },
          {
            narration: "pan - a slow drift painted inside the scene.",
            duration: 2,
            transition: "pan",
          },
        ],
      },
      null,
      2,
    ),
  },
];

/** The template shown in the empty-timeline editor, before anything is pasted. */
export const DEFAULT_SCENE_JSON_TEMPLATE_ID = "section";

/** Looks a template up by id, or returns null for an unknown one. */
export function sceneJsonTemplate(id: string): SceneJsonTemplate | null {
  return SCENE_JSON_TEMPLATES.find((t) => t.id === id) ?? null;
}
