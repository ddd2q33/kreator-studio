/**
 * Post templates, in the spirit of the book templates in components/templates.ts.
 *
 * These are not themes. A theme changes how a document looks; a template here is
 * a shape of post that reliably works on a feed, prefilled with the register the
 * book is written in — plain language, no diagnosis, no promise of a cure. The
 * studio's other tools hand over a canvas; this one hands over a structure,
 * because the reason a good post about trauma work gets ignored is almost never
 * the words, it is that the words arrived without a shape.
 *
 * Every starter is a real, complete post: `social-templates.test.ts` composes
 * each one for every network and fails if the result is empty or if the hook is
 * so long that the platform's own fold cuts it off. A template that arrives
 * pre-broken teaches the author to distrust the tool.
 *
 * Content note, and it is a real constraint rather than a disclaimer. Posts about
 * mental health travel further than the author intends and are read by people in
 * crisis who did not ask to be marketed to. The starters that touch suicidality,
 * dissociation or diagnosis therefore carry an instruction where the author
 * supplies their own crisis line, rather than this file guessing a number. A
 * wrong hotline number is worse than no post.
 *
 * The starters are in English because the manuscript they come from is, and a
 * translation pass belongs in one file: change the strings here and every
 * template follows.
 */

import { draftUid, type SocialDraft } from "./social-draft.ts";
import { defaultArt, styleLook, type StyleId } from "./social-art.ts";
import type { SocialNetworkId } from "./social-networks.ts";

export type SocialTemplate = {
  id: string;
  label: string;
  /** Grouping in the picker. */
  group: string;
  /** One line on what the shape is for. */
  description: string;
  /**
   * Why this shape holds up on a feed. Shown under the template, because the
   * author is the one who has to know when *not* to use it.
   */
  rationale: string;
  /**
   * Networks this shape is written for. Not a restriction — every template can
   * be sent to every network — just where it is expected to land, so the studio
   * can preselect them instead of leaving six boxes unticked.
   */
  networks: SocialNetworkId[];
  /**
   * The composed look the starter arrives dressed in. Curated per shape — a
   * quote is a poster, a myth is a card — and only a first move: the Design
   * panel keeps every knob editable afterwards.
   */
  look?: StyleId;
  /** The book template this post is a satellite of, when it is one. */
  bookTemplateId?: string;
  draft: Omit<SocialDraft, "id">;
};

const TRAUMA_TAGS = ["trauma", "mentalhealth", "healing", "therapy"];
const WORKBOOK_TAGS = ["journaling", "selfcare", "mindfulness", "growth"];
const SCIENCE_TAGS = ["neuroscience", "psychology", "evidencebased", "mentalhealth"];

const CLINICAL = "Educational content, not therapy or medical advice.";

export const SOCIAL_TEMPLATES: readonly SocialTemplate[] = [
  {
    id: "chapter-quote",
    look: "poster",
    label: "Chapter quote",
    group: "Trauma & healing",
    description:
      "One line lifted out of the book, with enough context that it can stand alone.",
    rationale:
      "The single most reused post in this genre, and the one most often done badly: a quote with no attribution reads as a fortune cookie. Naming the chapter is what makes it a book.",
    networks: ["instagram", "facebook", "threads"],
    bookTemplateId: "trauma",
    draft: {
      name: "Chapter quote",
      templateId: "chapter-quote",
      hook: "Trauma is not a bad memory. It is a nervous system still waiting for danger.",
      body: `This is the line I keep coming back to.

Most people describe their trauma as a file in the past — a room, a year, a person. What the body stores is closer to a *present tense*: the flinch before you know why, the sleep that will not come.

The memory ends. The response does not, until something tells it that it can.`,
      cta: "Chapter 1 is in the link in my bio. If this landed, save it.",
      hashtags: TRAUMA_TAGS,
    },
  },
  {
    id: "myth-vs-reality",
    look: "card",
    label: "Myth vs reality",
    group: "Trauma & healing",
    description:
      "One common belief, taken apart in six lines. The most reliable format on the platform.",
    rationale:
      "Myth/reality earns its reach because the reader recognises the myth in the first line and stays to check whether they are wrong. It has to be genuinely two-sided: a myth post that only knocks the myth down reads as a sales pitch.",
    networks: ["instagram", "facebook", "linkedin"],
    bookTemplateId: "trauma",
    draft: {
      name: "Myth vs reality",
      templateId: "myth-vs-reality",
      hook: "Myth: time heals it. Reality: time is not a treatment.",
      body: `What actually happens is less comfortable. Healing runs on **safety, then regulation, then connection** — in that order, and only in that order.

You cannot talk someone into processing a memory their nervous system is still defending. That is not stubbornness; it is a design feature.

So no, it is not that you have not waited long enough. It is that waiting was never the missing ingredient.`,
      cta: "The first chapter lays out the sequence in full. Link in bio.",
      hashtags: TRAUMA_TAGS,
    },
  },
  {
    id: "reflection-prompt",
    look: "aurora",
    label: "Reflection prompt",
    group: "Psychology workbook",
    description:
      "One question, formatted to be saved. The save is the metric, not the like.",
    rationale:
      "A prompt is the only post shape that gets *kept*, and keeping is worth more on every network. Put the question first, keep it to a single sentence, and it is screenshot-shaped by construction.",
    networks: ["instagram", "tiktok", "threads"],
    bookTemplateId: "psychology",
    draft: {
      name: "Reflection prompt",
      templateId: "reflection-prompt",
      hook: "When did you first learn that needing people was a weakness?",
      body: `Sit with that for a minute before you answer out loud.

Most of us learned it young, and almost never from anything dramatic. A parent exhausted at the end of a long day. A joke that landed once too often. A reward we got for coping.

The belief was not a flaw in you. It was an adaptation, and a good one.`,
      cta: "Save this for a quiet moment. 40 more prompts in the workbook.",
      hashtags: WORKBOOK_TAGS,
    },
  },
  {
    id: "worksheet-teaser",
    look: "clean",
    label: "Worksheet in three steps",
    group: "Psychology workbook",
    description:
      "An exercise broken into steps, with the free version inline and the full one behind the link.",
    rationale:
      "Giving away the first three steps of a worksheet is the trade that works: the reader gets something usable now, and the book is what they reach for when the third step runs out.",
    networks: ["instagram", "facebook", "linkedin"],
    bookTemplateId: "psychology",
    draft: {
      name: "Worksheet teaser",
      templateId: "worksheet-teaser",
      hook: "A grounding exercise you can do in four minutes, standing up, in a bathroom if you have to.",
      body: `**1. Name five things you can see.** Not the things you *should* see. The ones that are actually there, including the ugly ones.

**2. Four things you can feel.** The chair. The floor. Your own hands. This is not a metaphor; the point is to put your attention in a body that is currently bracing.

**3. Three things you can hear.** Then two you can smell, and one you can taste.

**4. Say one true thing about where you are.** Out loud if you can manage it. It is the step that does the work, and it is the one people skip.`,
      cta: "The full grounding worksheet, with a version for panic and one for nightmares, is in the workbook.",
      hashtags: WORKBOOK_TAGS,
    },
  },
  {
    id: "glossary",
    look: "editorial",
    label: "What it actually means",
    group: "Trauma & healing",
    description:
      "One clinical term, unpacked in the plainest language available, then dropped.",
    rationale:
      "Jargon is the enemy here. A reader who has just been handed *dissociation* for the third time by a stranger online needs it defined, and defining it generously is the whole post.",
    networks: ["instagram", "facebook", "threads"],
    bookTemplateId: "trauma",
    draft: {
      name: "Glossary",
      templateId: "glossary",
      hook: "Dissociation is not the same as spacing out.",
      body: `Spaced out is a tired mind. Dissociation is a **protected mind**: the part of you that stepped out so the rest of you did not have to be there.

It is why some people can describe the worst day of their life in perfect detail and no feelings at all. The memory is intact. The person who witnessed it is not in the room.

If that sounds familiar, it is not a character flaw and it is not rare. It is a very old solution that is now costing you something.`,
      cta: "Chapter 2, on the response cycle, if you want the mechanism behind it.",
      hashtags: TRAUMA_TAGS,
      // Threads holds 500 units and rewards a claim, not an explanation. This is
      // the same idea said out loud, which is the entire point of an override:
      // one draft, two posts.
      overrides: {
        threads: {
          body: `Spaced out is a tired mind. Dissociation is a *protected* mind: the part of you that stepped out so the rest of you did not have to be there.

It is why someone can describe the worst day of their life in perfect detail and no feeling at all. The memory is intact. The witness is not in the room.

Not a character flaw. Not rare. A very old solution that now costs you something.`,
          cta: "",
        },
      },
    },
  },
  {
    id: "case-note",
    look: "frame",
    label: "Case note, anonymised",
    group: "Trauma & healing",
    description:
      "A composite case from clinical practice, written as a story rather than a data point.",
    rationale:
      "Composite cases are the bridge between a textbook and a person, and they are also the highest-risk shape in this catalogue: the detail has to be altered enough that no one is identifiable, and the author has to be sure of that themselves. The instruction below is not a formality.",
    networks: ["linkedin", "facebook"],
    bookTemplateId: "trauma",
    draft: {
      name: "Case note",
      templateId: "case-note",
      hook: "She had been telling the same story for three years. The story was never the problem.",
      body: `Every session began the same way and ended the same way: the relationship, the betrayal, the account of what was said and when.

The story was accurate. It was also, I eventually realised, the only part of her life that had an ending — and she was not prepared to give it up.

We did not go back to it. We went forward: what was the first week after it ended, and who had she been that week?

Progress looked like a sentence with a different tense.`,
      cta: "If this pattern is familiar, the chapter on narrative and recovery is in the link in my bio.",
      hashtags: TRAUMA_TAGS,
    },
  },
  {
    id: "evidence-digest",
    look: "card",
    label: "What the evidence says",
    group: "Psychology workbook",
    description:
      "A finding from the literature, reported with the caveat that the field actually has.",
    rationale:
      "Authority is the scarcest thing in this subject, and it is wasted by overclaiming. Quoting a study and then saying what it does not show is the fastest way to be trusted by the readers who matter.",
    networks: ["linkedin", "facebook", "threads"],
    bookTemplateId: "medical",
    draft: {
      name: "Evidence digest",
      templateId: "evidence-digest",
      hook: "Naming a feeling does not reduce it. Naming it precisely does.",
      body: `The distinction matters more than it sounds. Vague labels — *anxiety*, *stress* — describe a category. Precise labels — *the specific dread of being touched without warning* — describe a sensation you can locate.

Once a sensation can be located, it can be tracked, and something that moves can be worked with.

What the research does **not** show: that naming alone is a treatment. It is a precondition for one, and the distinction is the part most posts online leave out.`,
      cta: `Sources and the rest of the digest are in the workbook. ${CLINICAL}`,
      hashtags: SCIENCE_TAGS,
      overrides: {
        threads: {
          body: `Naming a feeling does not reduce it. Naming it *precisely* does.

*Anxiety* describes a category. *The specific dread of being touched without warning* describes a sensation you can locate.

Once it can be located, it can be tracked — and something that moves can be worked with.

What the research does not show: that naming alone is a treatment. It is a precondition for one.`,
          cta: "",
        },
      },
    },
  },
  {
    id: "crisis-resources",
    // Humble on purpose: a post that points at help does not need a look.
    look: "clean",
    label: "Support, not advice",
    group: "Community",
    description:
      "A post that points at help instead of offering it, for the times a follower is in trouble.",
    rationale:
      "Sometimes the useful post is not a lesson but a door. Two rules make this shape work. It must not compete with the link — no CTA, no book, no hashtags doing marketing work on the way to a crisis line. And the crisis line must be the author's own: a wrong number, from a stranger, is a worse outcome than no post at all, so the starter ships a REPLACE marker rather than a number anyone might publish by accident. Delete the marker once you have filled it in.",
    networks: ["instagram", "facebook", "threads"],
    draft: {
      name: "Support resources",
      templateId: "crisis-resources",
      hook: "If today is a day where the plan has stopped making sense, read this.",
      body: `REPLACE: your local crisis line, how to reach it, and its hours.

A crisis line will not fix what is happening. It is someone who stays on the line while you decide what to do next, and that is the part people forget is available.

In immediate danger, contact your local emergency number.`,
      cta: "",
      hashtags: [],
    },
  },
  {
    id: "book-launch",
    look: "aurora",
    label: "Book announcement",
    group: "Publishing",
    description:
      "The book itself, in the third person, with a reason to read it that is not a discount.",
    rationale:
      "Announcement posts underperform whenever they are about the book. This shape leads with the reader's problem instead and mentions the book in the last two lines, which is also the only honest version.",
    networks: ["instagram", "facebook", "linkedin"],
    bookTemplateId: "trauma",
    draft: {
      name: "Book announcement",
      templateId: "book-launch",
      hook: "A book about trauma, for people who have been handed the advice to simply move on.",
      body: `Most books on this subject fall into one of two camps. The clinical ones are accurate and unreadable. The readable ones are full of advice that would not survive contact with an actual person in an actual bad week.

This one starts from the assumption that you are not broken and that something has to be explained before it can be changed. Every chapter ends with something you can do today, and none of it requires you to have a diagnosis.`,
      cta: "Out now. Link in bio, and a chapter is free to read.",
      hashtags: ["trauma", "mentalhealth", "books", "healing"],
    },
  },
  {
    id: "behind-the-book",
    look: "editorial",
    label: "Behind the book",
    group: "Publishing",
    description:
      "How the manuscript was made. The post that reaches people who do not follow the subject.",
    rationale:
      "The one shape that reliably reaches outside the niche, because the subject is writing the book rather than explaining the subject. It also does the work of making the author someone worth following.",
    networks: ["instagram", "threads", "tiktok", "linkedin"],
    bookTemplateId: "trauma",
    draft: {
      name: "Behind the book",
      templateId: "behind-the-book",
      hook: "I deleted the first draft of the introduction four times.",
      body: `Not revised. Deleted. It kept opening with a definition, and no one has ever been motivated by a definition.

The version that survived opens with a person waiting for a reply that is not coming, and it does not explain anything for two full pages.

Writing about the worst day of someone's life is a strange thing to do at length. The discipline was almost entirely in the cutting: every paragraph that explained the feeling instead of letting the reader arrive at it had to go.`,
      cta: "The chapter that took longest is the one people write to me about.",
      hashtags: ["writing", "books", "nonfiction", "healing"],
      overrides: {
        threads: {
          body: `I deleted the first draft of the introduction four times.

Not revised. Deleted. It kept opening with a definition, and no one has ever been motivated by a definition.

The version that survived opens with a person waiting for a reply that is not coming, and explains nothing for two full pages.

The discipline was in the cutting.`,
          cta: "The chapter that took longest is the one people write about.",
        },
      },
    },
  },
  {
    id: "blank",
    label: "Blank post",
    group: "Community",
    description: "An empty draft with the shape fields, for writing from scratch.",
    rationale:
      "Every other template in here presumes a certain kind of day. This one presumes nothing, and it is the one to reach for when none of the others fit — a note, an announcement, a reply to a question in the comments.",
    networks: ["instagram", "facebook", "tiktok", "threads", "x", "linkedin"],
    draft: {
      name: "",
      templateId: "blank",
      hook: "",
      body: "",
      cta: "",
      hashtags: [],
    },
  },
];

export const SOCIAL_TEMPLATE_GROUPS: readonly { label: string; ids: readonly string[] }[] =
  (() => {
    const order: string[] = [];
    const groups = new Map<string, string[]>();
    for (const template of SOCIAL_TEMPLATES) {
      if (!groups.has(template.group)) {
        groups.set(template.group, []);
        order.push(template.group);
      }
      groups.get(template.group)!.push(template.id);
    }
    return order.map((label) => ({ label, ids: groups.get(label)! }));
  })();

export const DEFAULT_SOCIAL_TEMPLATE_ID = "chapter-quote";

export function socialTemplateById(id: string | null | undefined): SocialTemplate {
  return (
    SOCIAL_TEMPLATES.find((t) => t.id === id) ??
    SOCIAL_TEMPLATES.find((t) => t.id === DEFAULT_SOCIAL_TEMPLATE_ID)!
  );
}

/** A fresh, unsaved draft from a template. */
export function draftFromTemplate(id: string): SocialDraft {
  const template = socialTemplateById(id);
  // structuredClone rather than a spread: the starter hashtags array is shared
  // with the module-level template, and editing one post's tags would otherwise
  // rewrite the template for every post opened afterwards.
  const draft = structuredClone(template.draft);
  if (template.look) {
    // The starter arrives dressed in its look — palette, face and composition
    // together — so the first preview is already a poster or a card rather than
    // a default frame. Every knob stays editable in the Design panel.
    draft.art = { ...defaultArt(), ...styleLook(template.look) };
  }
  return { ...draft, id: draftUid() };
}
