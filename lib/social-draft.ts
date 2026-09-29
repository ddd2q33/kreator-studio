/**
 * The social post: one draft, two source views, three networks.
 *
 * The studio keeps one canonical object — `SocialDraft` — and the author edits
 * it in whichever view suits them. Markdown is for writing the post, JSON is for
 * a post that several people hand-edit or generate from somewhere, and neither
 * is allowed to become the stored truth, because the two cannot both be it. Both
 * are projections of the same draft, which is why the round trip is the part
 * that is tested hardest: a lossy conversion here would silently eat the
 * author's words every time they switched tabs, and there is no undo for a
 * paragraph that vanished.
 *
 * The markdown projection uses HTML-comment fences rather than headings, for
 * the same reason the manuscript uses `<!-- chapter: … -->` markers: comments
 * survive a paste out of any editor without a markdown extension, they can wrap
 * content that itself contains headings, and they are invisible in a preview.
 * A `## Body` heading cannot contain a `## Body` line, and authors do paste
 * those.
 *
 * Text with no fences at all is read as the body. That is the case that matters
 * most in practice — someone drops a paragraph drafted in a notes app into the
 * editor and expects a post, not a parse error.
 */

import { cleanHashtag } from "./social-networks.ts";
import type { SocialNetworkId } from "./social-networks.ts";
import { normalizeArt, type PostArt } from "./social-art.ts";

/** A per-network replacement for the shared fields, when one idea needs two shapes. */
export type SocialOverride = {
  hook?: string;
  body?: string;
  cta?: string;
  hashtags?: string[];
};

export type SocialDraft = {
  id: string;
  /** Title in the drafts list. Falls back to the hook when empty. */
  name: string;
  /** Which starter this came from; drives the "Reset to template" action. */
  templateId: string;
  /** The opening line. This is the only part most readers will see. */
  hook: string;
  /** The post itself, in markdown. */
  body: string;
  /** Closing call to action. */
  cta: string;
  /** Without the leading `#`. */
  hashtags: string[];
  overrides?: Partial<Record<SocialNetworkId, SocialOverride>>;
  /**
   * How this post is dressed: canvas, font, layout, background photo.
   *
   * It lives on the draft because the design is per-post, but it is
   * deliberately absent from the markdown projection — a `.md` file is a way to
   * move the words around, and a word processor has no opinion about which
   * photograph sits behind them.
   */
  art?: PostArt;
};

/**
 * Local id generator.
 *
 * This is deliberately not the `uid` from lib/projects.ts. The Post Editor never
 * opens the book project store, and importing from there would tie this route's
 * bundle to the manuscript's persistence layer for the sake of six characters
 * of function body.
 */
export function draftUid(prefix = "post-"): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function emptyDraft(templateId = "custom"): SocialDraft {
  return {
    id: draftUid(),
    name: "",
    templateId,
    hook: "",
    body: "",
    cta: "",
    hashtags: [],
  };
}

/** The title to show in the drafts list, so a nameless draft is still findable. */
export function draftTitle(draft: SocialDraft): string {
  const name = draft.name.trim();
  if (name) return name;
  const hook = draft.hook.trim().split("\n")[0] ?? "";
  if (hook) return hook.length > 60 ? `${hook.slice(0, 57)}…` : hook;
  const body = draft.body.trim().split("\n")[0] ?? "";
  return body ? (body.length > 60 ? `${body.slice(0, 57)}…` : body) : "Untitled post";
}

/* ------------------------------------------------------------------ *
 * Markdown projection
 * ------------------------------------------------------------------ */

/**
 * Field order is the order the blocks are written and read.
 *
 * `template` is the fence name for the draft's `templateId`. It is in the
 * markdown rather than kept alongside it because "Reset to template" needs it,
 * and a view that cannot express a field the editor relies on will eventually
 * lose it the first time someone switches tabs mid-edit.
 *
 * `id` is deliberately absent. A pasted markdown document is a *new* post, and
 * minting a fresh id is the honest reading of that; keeping the id would let a
 * paste silently overwrite whatever post was open.
 */
const MARKDOWN_FIELDS = [
  "name",
  "template",
  "hook",
  "body",
  "cta",
  "hashtags",
] as const;
type MarkdownField = (typeof MARKDOWN_FIELDS)[number];

const OPEN = /^<!--\s*social:([a-z]+)\s*-->/i;
const CLOSE = /<!--\s*\/social\s*-->/i;

function fence(field: MarkdownField, value: string): string {
  return `<!-- social:${field} -->\n${value.replace(/\s+$/, "")}\n<!-- /social -->`;
}

export function draftToMarkdown(draft: SocialDraft): string {
  const values: Record<MarkdownField, string> = {
    name: draft.name,
    template: draft.templateId,
    hook: draft.hook,
    body: draft.body,
    cta: draft.cta,
    hashtags: draft.hashtags.join(" "),
  };
  return (
    MARKDOWN_FIELDS.map((field) => fence(field, values[field])).join("\n\n") + "\n"
  );
}

/**
 * Reads a draft out of the markdown view.
 *
 * Tolerant by design, and in this order of preference:
 *   1. fenced blocks, in any order, with unknown field names skipped;
 *   2. a single unfenced document, taken as the body;
 *   3. an empty document, taken as an empty draft.
 *
 * Two rules keep it from being lossy in the ways that matter:
 *
 *   - A block that is never closed runs to the end of the document. Strictness
 *     would cost more than it saves here, because the usual cause is a paste
 *     that lost its last fence, and throwing the author's paragraph away over a
 *     missing comment is the worst possible response to that.
 *   - `base` carries over the fields markdown cannot express. A view must not be
 *     able to destroy state it does not display: without this, opening the
 *     markdown tab and typing one character would wipe every per-network
 *     override the author had spent an afternoon writing.
 *
 * There is one thing this projection genuinely cannot carry, and it is worth
 * stating rather than discovering: a field whose text contains a *complete*
 * fence pair, such as a post about HTML comments or a pasted code sample, is
 * indistinguishable from real structure and is read as structure. There is no
 * escape that survives a paste out of another editor, and inventing one would
 * put invisible characters in the author's caption. First-fence-wins bounds the
 * damage to the field that actually contained the pair — everything else still
 * round-trips — and `draftToJson` is the lossless projection, which is the tab
 * to reach for when a post contains markup of any kind.
 */
export function markdownToDraft(markdown: string, base?: SocialDraft): SocialDraft {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const found: Partial<Record<MarkdownField, string[]>> = {};
  const stray: string[] = [];

  let current: MarkdownField | null = null;
  let buffer: string[] = [];

  const flush = () => {
    // First fence wins. `draftToMarkdown` writes the fields in a fixed order
    // with the body's real fence first, so when content contains a fence pair
    // of its own the nested one arrives second and is ignored. Without this
    // rule a post about HTML comments would silently overwrite the hook with
    // the first line of its own body — real corruption, of the one field the
    // author is least able to check.
    if (current && found[current] === undefined) found[current] = buffer;
    current = null;
    buffer = [];
  };

  for (const line of lines) {
    const open = OPEN.exec(line);
    if (open) {
      flush();
      const name = open[1].toLowerCase() as MarkdownField;
      // An unknown field is skipped rather than opened, so its body lands in
      // `stray` and is discarded instead of poisoning the next known block.
      current = MARKDOWN_FIELDS.includes(name) ? name : null;
      // Content on the same line as the fence is kept: a hand-written block
      // should not need a newline to work.
      const rest = line.slice(open[0].length).replace(/^\s/, "");
      if (rest) {
        if (current) buffer.push(rest);
        else stray.push(rest);
      }
      continue;
    }

    const close = CLOSE.exec(line);
    if (close) {
      // Likewise for content before a closing marker on the same line.
      const before = line.slice(0, close.index).trim();
      if (before && current) buffer.push(before);
      flush();
      continue;
    }

    if (current) buffer.push(line);
    else stray.push(line);
  }
  flush();

  const text = (field: MarkdownField): string =>
    (found[field] ?? []).join("\n").replace(/^\n+|\s+$/g, "");

  const hasFences = MARKDOWN_FIELDS.some((field) => found[field] !== undefined);

  return normalizeDraft({
    ...emptyDraft(),
    // The open post keeps its identity; a pasted document gets a fresh one.
    // normalizeDraft only accepts a non-empty id, so `undefined` mints a new
    // one exactly as it should here.
    id: base?.id,
    name: text("name"),
    templateId: text("template") || base?.templateId || "custom",
    hook: text("hook"),
    body: found.body ? text("body") : hasFences ? "" : stray.join("\n").trim(),
    cta: text("cta"),
    hashtags: parseHashtagLine(text("hashtags")),
    // The fields markdown has no fence for. Carried over rather than reset: the
    // design is a separate concern from the words, so re-parsing a caption must
    // not throw away the photograph behind it.
    overrides: base?.overrides,
    art: base?.art,
  });
}

/** `#a #b`, `a, b`, or one per line all land in the same list. */
function parseHashtagLine(value: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(/[\s,]+/)) {
    const tag = cleanHashtag(part);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * JSON projection
 * ------------------------------------------------------------------ */

/**
 * The JSON view carries everything markdown does plus the per-network
 * overrides, so this is the lossless projection — which is the reason to reach
 * for it when a post is being hand-edited or generated elsewhere.
 *
 * `id` is omitted on purpose, for the same reason it is omitted from markdown: a
 * pasted document is a new post. The editor passes its open draft as `base` so
 * that editing JSON in place keeps the post's identity instead of minting a new
 * one on every keystroke.
 */
export function draftToJson(draft: SocialDraft): string {
  const serialised: Record<string, unknown> = {
    name: draft.name,
    templateId: draft.templateId,
    hook: draft.hook,
    body: draft.body,
    cta: draft.cta,
    hashtags: draft.hashtags,
  };
  if (draft.overrides && Object.keys(draft.overrides).length > 0) {
    serialised.overrides = draft.overrides;
  }
  // `art` is deliberately absent, even though the draft carries it. A background
  // photo is a few hundred kilobytes of data URL, and a textarea holding that is
  // no longer something a person can read or retype. JSON stays the projection
  // of the *words*; the design has its own controls and is persisted alongside
  // this object. Hand-written JSON may still carry an `art` block — normalizeDraft
  // will read it — it just is not echoed back.
  return JSON.stringify(serialised, null, 2);
}

export type DraftResult =
  | { ok: true; draft: SocialDraft }
  | { ok: false; error: string };

/**
 * JSON → draft.
 *
 * The error is returned rather than thrown because the caller is a textarea the
 * author is typing into: a thrown exception would take the editor down on the
 * first unbalanced brace, and the author would lose the post they were writing.
 */
export function jsonToDraft(json: string, base?: SocialDraft): DraftResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "A post must be a JSON object." };
  }
  const draft = normalizeDraft(value);
  const merged: SocialDraft = {
    ...draft,
    // Identity and the fields the document did not mention. See the note on
    // draftToJson: without this, every keystroke would rename the post.
    id: base?.id ?? draft.id,
    templateId:
      draft.templateId === "custom"
        ? (base?.templateId ?? draft.templateId)
        : draft.templateId,
  };
  // Spreading a possibly-undefined `overrides` would leave an explicit
  // `overrides: undefined` key behind, which is not the same object as one
  // without the key — and this draft is persisted and diffed.
  const overrides = hasKey(value, "overrides") ? draft.overrides : base?.overrides;
  if (overrides) merged.overrides = overrides;
  // Same rule for the design: a hand-written JSON that never mentions the look
  // should leave the photograph and the chosen face alone.
  if (!hasKey(value, "art") && base?.art) merged.art = base.art;
  return { ok: true, draft: merged };
}

/** True when the document actually carried this key. */
function hasKey(value: unknown, key: string): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    key in (value as Record<string, unknown>)
  );
}

/**
 * Coerces anything into a valid draft.
 *
 * Every field is taken only if it is the right type, and anything unrecognised
 * is dropped rather than passed through. That is the whole contract: a draft
 * that came out of here is safe to render, count and compose, whatever it went
 * in as. A pasted file with `"body": 42` gets an empty body instead of the
 * string "42" appended to someone's post.
 */
export function normalizeDraft(value: unknown): SocialDraft {
  const input = (
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  );

  const str = (key: string): string =>
    typeof input[key] === "string" ? (input[key] as string) : "";

  const base: SocialDraft = {
    id: typeof input.id === "string" && input.id ? input.id : draftUid(),
    name: str("name"),
    templateId: str("templateId") || "custom",
    hook: str("hook"),
    body: str("body"),
    cta: str("cta"),
    hashtags: readHashtags(input.hashtags),
  };

  const overrides = readOverrides(input.overrides);
  if (overrides) base.overrides = overrides;
  // The design is not prose, so it is kept out of the markdown projection
  // entirely: `markdownToDraft(md, base)` carries it across, and a markdown
  // post typed from nothing gets the default look.
  if (input.art !== undefined) base.art = normalizeArt(input.art);
  return base;
}

function readHashtags(value: unknown): string[] {
  // An array is the documented shape, but a pasted file may hold a single
  // string, and one string is unambiguous, so it is accepted.
  const parts = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const tag = cleanHashtag(part);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function readOverrides(value: unknown): SocialDraft["overrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: NonNullable<SocialDraft["overrides"]> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const override: SocialOverride = {};
    if (typeof entry.hook === "string") override.hook = entry.hook;
    if (typeof entry.body === "string") override.body = entry.body;
    if (typeof entry.cta === "string") override.cta = entry.cta;
    if (Array.isArray(entry.hashtags)) override.hashtags = readHashtags(entry.hashtags);
    if (Object.keys(override).length > 0) out[key as SocialNetworkId] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A fresh copy of a draft with a new id, for "Duplicate". */
export function cloneDraft(draft: SocialDraft): SocialDraft {
  return {
    ...structuredCloneish(draft),
    id: draftUid(),
    overrides: draft.overrides
      ? Object.fromEntries(
          Object.entries(draft.overrides).map(([k, v]) => [k, { ...v }]),
        )
      : undefined,
  };
}

function structuredCloneish(draft: SocialDraft): SocialDraft {
  return { ...draft, hashtags: [...draft.hashtags] };
}
