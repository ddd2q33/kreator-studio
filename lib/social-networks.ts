/**
 * The networks the Post Editor knows how to write for.
 *
 * This file is the whole reason the studio can claim a post "fits". Every other
 * social tool in the browser shows a character counter, and most of them are
 * measuring the wrong string: they count the text as it sits in the editor,
 * with markdown syntax still in it, and against a limit copied off a help page
 * that was written for a different network three years ago. Three things follow
 * from that and are handled here instead:
 *
 *   1. No network renders markdown. A `**bold**` in a caption is six literal
 *      characters, so the counter has to run against the flattened text — the
 *      text that actually gets pasted — not against the source. That is
 *      `markdownToPlainText`, and every number in the UI comes from it.
 *   2. A limit is not a single number. Each network has a hard cap (the post is
 *      rejected or truncated) and a soft target (the feed has already folded
 *      the text behind a "see more"). The soft number is the one that decides
 *      whether a post reads, so both are kept and shown.
 *   3. Counters disagree about emoji. X charges two units for a pictograph, so
 *      `textLength` alone under-reports a caption full of them by 30% or more.
 *      `measurePost` counts with that weight instead.
 *
 * The numbers below are what each platform documents today. They will drift, and
 * when they do this is the only file that needs to change: the UI never writes
 * a limit inline, it reads `hard`, `soft` and `preview` off the network.
 */

import type { SocialDraft } from "./social-draft.ts";

export type SocialNetworkId =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "threads"
  | "x"
  | "linkedin";

/** How a network treats a hashtag written into the caption. */
export type HashtagBehaviour =
  /** Hashtags are appended by the composer and read as tags by the platform. */
  | "indexed"
  /** Hashtags work, but the platform treats a wall of them as spam. */
  | "discouraged"
  /** TikTok: readable, largely not searchable. Fine, but not leverage. */
  | "visual";

export type SocialNetwork = {
  id: SocialNetworkId;
  label: string;
  /** One line on how this network is actually written to. */
  hint: string;
  /** The platform's own hard cap. Past this the post is cut or refused. */
  hard: number;
  /**
   * Where the feed folds the caption behind a "see more". Engagement past this
   * point is a guess, but it is the guess the whole studio is built on.
   */
  soft: number;
  /** Characters visible before the fold in the timeline. */
  preview: number;
  /** How many hashtags the composer will append before it stops. */
  hashtagCap: number | null;
  hashtagBehaviour: HashtagBehaviour;
  /** Units this network charges for one pictograph. */
  emojiCost: 1 | 2;
  /** True when the network breaks the caption into paragraphs on its own. */
  honoursParagraphs: boolean;
};

/**
 * Ordered by how much the studio expects them to be used, not by launch order.
 * The first three are the ones the author asks for by name, so they open the
 * picker; the rest are there because a therapeutic audience posts on all of
 * them and refusing to would just push the work into another tab.
 */
export const NETWORKS: readonly SocialNetwork[] = [
  {
    id: "instagram",
    label: "Instagram",
    hint: "Long captions do get read, but the fold sits at 125 characters. Lead with the hook or nobody reaches line two.",
    hard: 2200,
    soft: 1000,
    preview: 125,
    hashtagCap: 30,
    hashtagBehaviour: "indexed",
    emojiCost: 1,
    honoursParagraphs: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    hint: "Effectively unlimited, and the only network where a long, honest paragraph still gets finished. Three hashtags is plenty.",
    hard: 63206,
    soft: 2000,
    preview: 480,
    hashtagCap: 3,
    hashtagBehaviour: "discouraged",
    emojiCost: 1,
    honoursParagraphs: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    hint: "The caption is a footnote to the video. Keep the spoken hook in the caption itself so it survives muted autoplay.",
    hard: 2200,
    soft: 150,
    preview: 100,
    hashtagCap: 6,
    hashtagBehaviour: "visual",
    emojiCost: 1,
    honoursParagraphs: true,
  },
  {
    id: "threads",
    label: "Threads",
    hint: "A conversation, not a broadcast. 500 units, shown in full — and short, opinionated, and ending in something answerable.",
    hard: 500,
    // Threads shows the whole 500-unit post, so there is no fold and no soft
    // target below the cap. `soft` equals `hard` rather than being left out
    // because the studio's progress bar reads it, and a network with no fold is
    // a fact the author should see rather than a missing value.
    soft: 500,
    preview: 500,
    hashtagCap: 5,
    hashtagBehaviour: "indexed",
    emojiCost: 1,
    honoursParagraphs: true,
  },
  {
    id: "x",
    label: "X",
    hint: "280 units, and every emoji costs two. A long thread is a different post that has to be composed separately.",
    hard: 280,
    soft: 280,
    preview: 240,
    hashtagCap: 2,
    hashtagBehaviour: "indexed",
    emojiCost: 2,
    honoursParagraphs: true,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    hint: "Long form and no audience penalty, but a clinical register that is out of place there. The fold is at 210 characters.",
    hard: 3000,
    soft: 800,
    preview: 210,
    hashtagCap: 5,
    hashtagBehaviour: "discouraged",
    emojiCost: 1,
    honoursParagraphs: true,
  },
];

export const DEFAULT_NETWORK_ID: SocialNetworkId = "instagram";

export function networkById(id: string | null | undefined): SocialNetwork {
  return (
    NETWORKS.find((n) => n.id === id) ??
    NETWORKS.find((n) => n.id === DEFAULT_NETWORK_ID)!
  );
}

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

type SegmenterCtor = typeof Intl.Segmenter extends undefined
  ? never
  : { new (l?: string, o?: { granularity?: string }): Intl.Segmenter };

/**
 * Grapheme segmentation, when the runtime has it.
 *
 * `String.length` counts UTF-16 code units, so a single emoji reads as 2 and a
 * flag as 8, which makes the counter disagree with the platform on exactly the
 * captions people most want to use emoji in. `Intl.Segmenter` is the correct
 * unit and is present in every browser this studio supports; the fallback below
 * is only for a stripped-down runtime and counts code points, which is closer
 * than UTF-16 units even when it is not perfect.
 */
const segmenter: Intl.Segmenter | null = (() => {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    return null;
  }
  try {
    return new (Intl.Segmenter as unknown as SegmenterCtor)(undefined, {
      granularity: "grapheme",
    });
  } catch {
    return null;
  }
})();

/** Graphemes, the unit a reader thinks in. */
export function textLength(value: string): number {
  if (!value) return 0;
  if (segmenter) return Array.from(segmenter.segment(value)).length;
  return Array.from(value).length;
}

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u;

/** Splits into graphemes, always as strings, whether or not we can segment. */
function graphemesOf(value: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(value), (s) => s.segment);
  return Array.from(value);
}

/**
 * What the network's own counter would show.
 *
 * `emojiCost` is the only adjustment. It is deliberately narrow: it tests for
 * pictographs, not "anything non-ASCII", because an accented letter costs the
 * same on every network and charging it extra would be a bug that only shows up
 * in Spanish text — which is this author's language.
 */
export function weightedLength(value: string, network: SocialNetwork): number {
  if (!value) return 0;
  if (network.emojiCost === 1) return textLength(value);
  let total = 0;
  for (const grapheme of graphemesOf(value)) {
    total += PICTOGRAPH.test(grapheme) ? 2 : 1;
  }
  return total;
}

export type PostMeasure = {
  /** The composed text, ready to paste. */
  text: string;
  /** Units by the network's own counting rules. */
  length: number;
  hard: number;
  soft: number;
  /** Over the platform cap: the platform will cut or refuse it. */
  overHard: boolean;
  /** Past the fold. Not an error — a warning worth seeing. */
  overSoft: boolean;
  /** Units left before the hard cap. Negative when over. */
  remaining: number;
  /** 0–1 progress against the hard cap, clamped for the bar. */
  ratio: number;
  /** Text as it appears before the "see more". */
  foldedPreview: string;
  /** True when the preview had to be cut, i.e. the fold is not the end. */
  folded: boolean;
  hashtagsUsed: number;
  /** Hashtags the network's cap kept out of the post. */
  hashtagsDropped: number;
};

export function measurePost(
  text: string,
  network: SocialNetwork,
  hashtagsUsed = 0,
  hashtagsDropped = 0,
): PostMeasure {
  const length = weightedLength(text, network);
  const folded = length > network.preview;
  return {
    text,
    length,
    hard: network.hard,
    soft: network.soft,
    overHard: length > network.hard,
    overSoft: length > network.soft,
    remaining: network.hard - length,
    ratio: Math.max(0, Math.min(1, length / network.hard)),
    foldedPreview: text.slice(0, network.preview),
    folded,
    hashtagsUsed,
    hashtagsDropped,
  };
}

/* ------------------------------------------------------------------ *
 * Markdown → what the network will actually show
 * ------------------------------------------------------------------ */

/**
 * Flattens the markdown the author writes into the text a caption can hold.
 *
 * Two decisions here are not obvious and both are deliberate:
 *
 *   - **Line breaks are preserved exactly.** Markdown semantics would reflow a
 *     paragraph into one long line. A caption is not a paragraph of prose: on
 *     every network here the author's line breaks are the layout, and the way
 *     they break a sentence across three short lines is the difference between
 *     a post that scans and a wall of text.
 *   - **Book furniture is dropped rather than escaped.** Manuscript directives
 *     (`::: worksheet`) and thematic rules are meaningful in a .md file and are
 *     noise in a caption. Pasting a chapter in should give a caption, not the
 *     chapter's scaffolding.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return "";

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  // Directives are fenced: `::: name` runs until a closing `:::`. Tracking the
  // fence is what stops a body from being silently cut in half by one opener.
  let inDirective = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (/^\s*:::/.test(line)) {
      inDirective = !inDirective;
      continue;
    }
    if (inDirective) continue;

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
    if (/^\s*={2,}\s*$/.test(line)) continue;

    const flat = flattenLine(line);
    // null, not "": a table's header rule has to leave no trace, and an empty
    // string would open a blank line in the middle of two rows of a caption.
    if (flat !== null) out.push(flat);
  }

  return collapseBlankRuns(out.join("\n"));
}

/**
 * Flattens one line, or returns null when the line should not appear at all.
 *
 * `stripIndent` runs first and unconditionally, which dedents the whole
 * document. That is deliberate: markdown's leading whitespace is structure, and
 * in a caption it is a stray tab. It also means the list replacements below have
 * nothing to preserve, so they do not try.
 */
function flattenLine(line: string): string | null {
  let text = stripIndent(line);

  // ATX heading. The hashes are layout in a manuscript and characters in a
  // caption, and the first line is the hook, which must survive intact.
  text = text.replace(/^#{1,6}\s+/, "");

  // Blockquote: the quote is the point, the marker is not.
  text = text.replace(/^>\s?/, "");

  // Tables survive as `cell | cell` — dropping the header rule keeps the
  // columns legible without pretending to be a table.
  if (text.includes("|")) {
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(text)) return null;
    text = text.replace(/^\s*\|/, "").replace(/\|\s*$/, "").trim();
  }

  // Lists: an unordered bullet reads better as a real bullet in a caption, and
  // the number is kept as-is for an ordered list. The dash is safe to include
  // because thematic rules were already filtered above, and `\s+` keeps a
  // negative number ("-5 degrees") out of it.
  text = text.replace(/^[-*+]\s+/, "• ");
  text = text.replace(/^(\d+)[.)]\s+/, "$1. ");

  return inlineMarkdown(text);
}

/** Drops the leading whitespace markdown uses to signal structure. */
function stripIndent(line: string): string {
  return line.replace(/^\s+/, "");
}

/** Inline spans, applied after the block markers so `**` inside a bullet works. */
function inlineMarkdown(text: string): string {
  return (
    text
      // Images before links: `![alt](src)` would otherwise lose the `!`.
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string) => alt)
      // A link keeps its target. Dropping the URL is the single most common way
      // a caption loses the one thing a reader needs.
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) =>
        label === href ? href : `${label} (${href})`,
      )
      .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_~]([^*_~][^*_]*?)[*_~](?=$|[\s.,!?:)])/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/** Collapses the blank-line piles that dropping block markers leaves behind. */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\s+$/, "");
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

/** Tags written inline in the body, so a caption can carry a tag the UI did not. */
export function extractHashtags(text: string): string[] {
  // matchAll, not match: with the `g` flag match returns whole matches only, and
  // reading `match[2]` off one of those silently returns a letter of the tag
  // rather than the tag.
  const found = Array.from(
    text.matchAll(/(^|\s)#([\p{L}\p{N}_]{2,})/gu),
    (match) => match[2],
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of found) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Normalises a tag the author typed, or the studio generated. */
export function cleanHashtag(tag: string): string {
  return tag
    .replace(/^[#\s]+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 60);
}

export function hashtagBlock(tags: string[], network: SocialNetwork): {
  text: string;
  used: number;
  dropped: number;
} {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = cleanHashtag(tag);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }
  const allowed =
    network.hashtagCap === null ? cleaned : cleaned.slice(0, network.hashtagCap);
  return {
    text: allowed.length ? allowed.map((t) => `#${t}`).join(" ") : "",
    used: allowed.length,
    dropped: cleaned.length - allowed.length,
  };
}

/**
 * Assembles the post for one network.
 *
 * The blocks are flattened in order and joined with a blank line, skipping any
 * that are empty, so a draft with no CTA does not get a leading blank line
 * where the CTA would have been. Per-network overrides on the draft win over
 * the shared fields; that is how a 2200-character Instagram caption and a
 * 280-unit version of the same idea share one draft.
 */
export function composePost(draft: SocialDraft, network: SocialNetwork): PostMeasure {
  const override = draft.overrides?.[network.id];
  const hook = override?.hook ?? draft.hook;
  const body = override?.body ?? draft.body;
  const cta = override?.cta ?? draft.cta;

  const flatHook = markdownToPlainText(hook);
  const flatBody = markdownToPlainText(body);
  const flatCta = markdownToPlainText(cta);

  const tags = hashtagBlock(override?.hashtags ?? draft.hashtags, network);

  const blocks = [flatHook, flatBody, flatCta, tags.text].filter((b) => b.trim().length > 0);
  const text = network.honoursParagraphs
    ? blocks.join("\n\n")
    : blocks.join(" ").replace(/[ \t]{2,}/g, " ");

  return measurePost(text, network, tags.used, tags.dropped);
}

/** Every network's rendering of one draft, for the "all networks" view. */
export function composeAll(draft: SocialDraft): Record<string, PostMeasure> {
  const out: Record<string, PostMeasure> = {};
  for (const network of NETWORKS) out[network.id] = composePost(draft, network);
  return out;
}
