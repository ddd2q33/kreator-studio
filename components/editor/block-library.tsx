"use client";

import { useMemo } from "react";
import {
  Activity,
  BookMarked,
  Box,
  ClipboardList,
  Quote,
  Sparkles,
  Workflow,
} from "lucide-react";
import { DIRECTIVE_EXAMPLE } from "@/lib/directives";

export type BlockSnippet = {
  id: string;
  kind: "directive" | "markdown";
  title: string;
  description: string;
  icon: typeof Box;
  snippet: string;
};

/**
 * Ready-to-insert building blocks. Directives map to the `:::` components in
 * lib/directives.ts (tool / worksheet / reflection / diagram / summary /
 * quote); markdown blocks are plain tables and writing lines.
 */
export const BLOCK_LIBRARY: BlockSnippet[] = [
  {
    id: "worksheet",
    kind: "directive",
    title: "Worksheet",
    description: "Labelled exercise sheet with writing lines",
    icon: ClipboardList,
    snippet: [
      '::: worksheet title="Worksheet title" purpose="What this one is for."',
      "Prompt one",
      "___",
      "Prompt two",
      "___",
      ":::",
    ].join("\n"),
  },
  {
    id: "reflection",
    kind: "directive",
    title: "Reflection",
    description: "Guided questions with a writing line after each",
    icon: Sparkles,
    snippet: [
      '::: reflection title="Reflection exercise" before="Take three slow breaths before answering."',
      "First question",
      "Second question",
      ":::",
    ].join("\n"),
  },
  {
    id: "tool",
    kind: "directive",
    title: "Tool",
    description: "Numbered practice with Purpose / How To Use sections",
    icon: Activity,
    snippet: [
      '::: tool number="01" title="Tool name"',
      "**Purpose:** Why this tool exists.",
      "**How To Use:**",
      "- Step one",
      "- Step two",
      "**Journal Space:**",
      "Reflection prompt",
      "___",
      ":::",
    ].join("\n"),
  },
  {
    id: "summary",
    kind: "directive",
    title: "Chapter Summary",
    description: "What You Learned / Key Takeaways / Practice",
    icon: BookMarked,
    snippet: [
      "::: summary",
      "#### What You Learned",
      "- Takeaway one",
      "#### Key Takeaways",
      "- Key point one",
      "#### Practice For This Week",
      "Practice instruction",
      "___",
      ":::",
    ].join("\n"),
  },
  {
    id: "quote",
    kind: "directive",
    title: "Pull Quote",
    description: "Centered highlight, optional attribution",
    icon: Quote,
    snippet: [
      '::: quote by="Author Name"',
      "The quoted line.",
      ":::",
    ].join("\n"),
  },
  {
    id: "diagram",
    kind: "directive",
    title: "Diagram",
    description: "Vertical flow of nodes with ↓ connectors",
    icon: Workflow,
    snippet: [
      '::: diagram caption="Caption" highlight="Healing"',
      "Node one",
      "↓",
      "Node two",
      "↓",
      "Healing response",
      ":::",
    ].join("\n"),
  },
  {
    id: "goals-table",
    kind: "markdown",
    title: "Goals Table",
    description: "Objective / How / Progress tracker table",
    icon: Box,
    snippet: [
      "| Objective | How I'll do it | Done? |",
      "| --------- | -------------- | ----- |",
      "|           |                | ☐     |",
      "|           |                | ☐     |",
    ].join("\n"),
  },
];

/** Full sample exercising every directive (from the Example button). */
export const DIRECTIVE_FULL_EXAMPLE = DIRECTIVE_EXAMPLE;

export function exampleBlocks(): BlockSnippet[] {
  return BLOCK_LIBRARY;
}

export function useBlockLibrary(): BlockSnippet[] {
  return useMemo(() => BLOCK_LIBRARY, []);
}

/** Insert a block snippet into a markdown string at a given offset. */
export function insertBlockAt(
  markdown: string,
  snippet: string,
  offset: number,
): { next: string; caret: number } {
  const head = markdown.slice(0, offset);
  const tail = markdown.slice(offset);
  const leading = /\n$/.test(head) ? "" : "\n";
  const trailing = /^\n/.test(tail) ? "" : "\n";
  const next = `${head}${leading}\n${snippet}\n${trailing}${tail}`;
  return { next, caret: offset + leading.length + snippet.length + 2 };
}