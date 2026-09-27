"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Open/closed state for the Asset Library, shared across the header and whichever
 * editor is mounted.
 *
 * The trigger sits in `StudioHeader` because that is the one bar both routes
 * have, but the panel itself has to stay inside the editor: its `onUse` handler
 * is what knows how to attach an image to a scene or drop one into a chapter.
 * A single flag is the whole of the coupling between them.
 *
 * Deliberately not React context. The header and the editor are siblings, not
 * parent and child, so a provider would mean lifting a wrapper around both
 * routes for the sake of one boolean.
 */

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The panel is closed on the server, and so on the first client render. */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Reads the shared flag and returns it with a setter.
 *
 * The setter takes the next value rather than a toggle so callers can say "open
 * it" without knowing its current state, which is what every caller here wants.
 */
export function useLibraryOpen(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => open, getServerSnapshot);
  const setOpen = useCallback((next: boolean) => {
    if (next === open) return;
    open = next;
    emit();
  }, []);
  return [value, setOpen];
}

/** True while the panel is open, for callers that only render. */
export function libraryIsOpen(): boolean {
  return open;
}
