import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  undo,
} from "../lib/scene-history.ts";

/** Shorthand for the common case: one discrete action. */
const act = <T,>(h: ReturnType<typeof createHistory<T>>, next: T) =>
  commit(h, next, { kind: "commit" });

describe("scene history", () => {
  it("starts with nothing to undo or redo", () => {
    const h = createHistory(["a"]);
    assert.equal(canUndo(h), false);
    assert.equal(canRedo(h), false);
    assert.deepEqual(undo(h).present, ["a"]);
    assert.deepEqual(redo(h).present, ["a"]);
  });

  it("undoes a committed action", () => {
    const h = act(createHistory(["a"]), ["a", "b"]);
    assert.equal(canUndo(h), true);
    assert.deepEqual(undo(h).present, ["a"]);
  });

  it("redoes what was undone", () => {
    const h = act(createHistory(["a"]), ["a", "b"]);
    const back = undo(h);
    assert.equal(canRedo(back), true);
    assert.deepEqual(redo(back).present, ["a", "b"]);
  });

  it("walks back several steps in order", () => {
    let h = createHistory(["a"]);
    h = act(h, ["a", "b"]);
    h = act(h, ["a", "b", "c"]);
    h = act(h, ["a", "b", "c", "d"]);
    h = undo(h);
    h = undo(h);
    assert.deepEqual(h.present, ["a", "b"]);
  });

  it("drops the redo branch once a new action lands", () => {
    // The expectation every editor has to meet: you cannot undo into the past
    // and then branch off into a different future.
    let h = act(createHistory(["a"]), ["a", "b"]);
    h = undo(h);
    assert.equal(canRedo(h), true);
    h = act(h, ["z"]);
    assert.equal(canRedo(h), false);
    assert.deepEqual(h.present, ["z"]);
  });

  it("ignores a write that handed back the same state", () => {
    // The contract every writer follows: return the input unchanged to mean
    // "nothing happened", so no undo step is spent on a no-op.
    const present = ["a"];
    const h = createHistory(present);
    const noop = act(h, present);
    assert.equal(canUndo(noop), false);
  });

  it("coalesces consecutive edits of the same field into one entry", () => {
    // The reason `edit` exists: a narration field typed one character at a time
    // must not need one undo per keystroke.
    let h = createHistory({ narration: "" });
    for (const narration of ["h", "he", "hel", "hell", "hello"]) {
      h = commit(h, { narration }, { kind: "edit", key: "narration" });
    }
    assert.equal(h.past.length, 1);
    assert.deepEqual(undo(h).present, { narration: "" });
  });

  it("starts a new entry when the field changes", () => {
    let h = createHistory({ narration: "", title: "" });
    h = commit(h, { narration: "h", title: "" }, { kind: "edit", key: "narration" });
    h = commit(h, { narration: "h", title: "T" }, { kind: "edit", key: "title" });
    assert.equal(h.past.length, 2);
    h = undo(h);
    assert.deepEqual(h.present, { narration: "h", title: "" });
  });

  it("does not coalesce a commit into a preceding edit", () => {
    // A paste after a keystroke is its own step, or undoing the paste would also
    // silently discard the character the author just typed.
    type Draft = { narration: string; pasted?: boolean };
    let h = createHistory<Draft>({ narration: "" });
    h = commit(h, { narration: "h" }, { kind: "edit", key: "narration" });
    h = act(h, { narration: "h", pasted: true });
    assert.equal(h.past.length, 2);
  });

  it("closes an edit run once undone", () => {
    // Undo is an action in its own right: the next keystroke after it must not
    // rewind past the undo as if nothing happened.
    let h = createHistory(["a"]);
    h = commit(h, ["a", "b"], { kind: "edit", key: "k" });
    h = undo(h);
    h = commit(h, ["a", "c"], { kind: "edit", key: "k" });
    assert.equal(h.past.length, 1);
  });

  it("keeps the stack bounded so a long session cannot grow without limit", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 40; i++) {
      h = act(h, i);
    }
    assert.equal(h.past.length, HISTORY_LIMIT);
  });

  it("survives an undo past the oldest entry", () => {
    let h = createHistory(["a"]);
    h = act(h, ["a", "b"]);
    for (let i = 0; i < 10; i++) h = undo(h);
    assert.deepEqual(h.present, ["a"]);
    for (let i = 0; i < 10; i++) h = redo(h);
    assert.deepEqual(h.present, ["a", "b"]);
  });
});
