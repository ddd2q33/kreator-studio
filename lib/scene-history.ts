/**
 * Undo/redo for the scene timeline.
 *
 * A history that records every `setScenes` call is useless: typing one character
 * in the narration field would push an entry, and thirty undos later the author
 * would be undoing their way through a word rather than back to before the paste
 * they regret. So writes are grouped two ways.
 *
 * - `commit` records a boundary. A delete, a paste, a reorder: one undo returns
 *   to before the whole action.
 * - `edit` coalesces. Consecutive edits under the same key replace each other, so
 *   a run of keystrokes in one field undoes as one, while a keystroke in a
 *   different field starts a new entry.
 *
 * A no-op write is detected by reference: callers signal "nothing changed" by
 * returning the state they were handed. That is cheaper than comparing a whole
 * scene array on every keystroke, and it is what the editor's writers already
 * do - `moveSceneStep` hands back the same array when a move is refused.
 *
 * The stack is bounded, because a long session would otherwise hold every
 * intermediate state of a long narration field in memory.
 */

export type HistoryEntry<T> = {
  /** The state as it was *before* the write. */
  past: T;
  /** Groups consecutive `edit` writes; a new key starts a new entry. */
  key: string | null;
};

/** How a write should be recorded. */
export type CommitMode =
  | { kind: "commit" }
  | { kind: "edit"; key: string };

export type History<T> = {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
  /** Key of the entry currently in `past`, so the next edit can coalesce. */
  lastKey: string | null;
};

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null };
}

/**
 * Records a write.
 *
 * `mode` decides whether this is worth its own undo step. `commit` always is;
 * `edit` joins the previous entry when it was an edit of the same field, so
 * dragging a slider produces one entry instead of two hundred.
 */
export function commit<T>(
  history: History<T>,
  next: T,
  mode: { kind: "commit" } | { kind: "edit"; key: string },
): History<T> {
  if (Object.is(next, history.present)) return history;

  const joinsPrevious =
    mode.kind === "edit" && history.lastKey !== null && history.lastKey === mode.key;

  const entry: HistoryEntry<T> = {
    past: history.present,
    key: mode.kind === "edit" ? mode.key : null,
  };

  // Coalescing keeps the *existing* entry, whose `past` is the state before the
  // run began. Overwriting it with the previous keystroke's state would make
  // undo land in the middle of the run - the half-typed word instead of the
  // empty field.
  const past = joinsPrevious ? history.past : [...history.past, entry];

  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: next,
    // A new write invalidates the redo branch, the same as in every editor.
    future: [],
    lastKey: mode.kind === "edit" ? mode.key : null,
  };
}

export function undo<T>(history: History<T>): History<T> {
  const entry = history.past[history.past.length - 1];
  if (!entry) return history;
  return {
    past: history.past.slice(0, -1),
    present: entry.past,
    future: [...history.future, { past: history.present, key: null }],
    lastKey: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  const entry = history.future[history.future.length - 1];
  if (!entry) return history;
  return {
    past: [
      ...history.past,
      { past: history.present, key: null },
    ],
    present: entry.past,
    future: history.future.slice(0, -1),
    lastKey: null,
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}
