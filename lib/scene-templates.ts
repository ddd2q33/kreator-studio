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
 * The full set, in the order the picker shows them: simplest first, so the
 * first three options cover every shape and the rest are reference material.
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
    id: "episode",
    label: "Whole episode",
    hint: "Many sections at once. Appended to the timeline.",
    json: JSON.stringify(episode, null, 2),
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
