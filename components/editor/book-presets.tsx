"use client";

import { GraduationCap, BookHeart, Cpu, Library, HeartPulse, ShieldCheck } from "lucide-react";
import type { CustomVariant } from "@/lib/projects";

export type BookPreset = {
  id: string;
  label: string;
  description: string;
  icon: typeof BookHeart;
  templateId: string;
  custom: CustomVariant;
  /** Starter markdown applied on "one-click" apply when the doc is empty. */
  starter: string;
};

export const BOOK_PRESETS: BookPreset[] = [
  {
    id: "programming",
    label: "Programming Book",
    description: "Technical guide with code blocks, callouts and TOC",
    icon: Cpu,
    templateId: "technical",
    custom: { accent: "#1D4ED8", font: "default", width: "wide" },
    starter: `# Programming Book

> [!TIP]
> Replace this with your introduction.

::: quote by="A programmer"
Simple things should be simple.
:::

## Getting started

Install and run your first example:

\`\`\`bash
npm run dev
\`\`\`

## Deep dive

Explain the mechanism here.

::: diagram caption="Execution flow" highlight="Result"
Input
↓
Processing
↓
Result
:::
`,
  },
  {
    id: "course",
    label: "Course Manual",
    description: "Teaching workbook — objectives, exercises, assessments",
    icon: GraduationCap,
    templateId: "psychology",
    custom: { accent: "#2F6F6A", font: "serif", width: "default" },
    starter: `# Course Manual

## Module objectives

- [ ] Objective one
- [ ] Objective two

| Module | Topic        | Hours | Status |
| ------ | ------------ | ----- | ------ |
| 1      | Foundations  | 2     | ☐      |

::: worksheet title="Assessment" purpose="Check understanding before moving on."
Question one
___
Question two
___
:::
`,
  },
  {
    id: "novel",
    label: "Novel",
    description: "Narrative template — chapters and prose, print-ready",
    icon: BookHeart,
    templateId: "trauma",
    custom: { accent: "#4A7C59", font: "serif", width: "narrow" },
    starter: `# Novel Title

::: chapter number=1 title="The Beginning"
Opening chapter content.
:::
`,
  },
  {
    id: "thesis",
    label: "Thesis",
    description: "Academic structure — abstract, sections, references",
    icon: Library,
    templateId: "technical",
    custom: { accent: "#4F46E5", font: "sans", width: "default" },
    starter: `# Thesis Title

**Abstract**

One paragraph that summarises the whole thesis.

## 1. Introduction

Motivate the problem.

## 2. Method

Describe the approach.

### 2.1 Participants

### 2.2 Procedure

## 3. Results

## 4. Discussion

## References

- Everhart, D. (2026). *A study*. Publisher.
`,
  },
  {
    id: "therapy",
    label: "Therapy Workbook",
    description: "Trauma-informed exercises, boxes and reflection space",
    icon: HeartPulse,
    templateId: "trauma",
    custom: { accent: "#3E5C76", font: "default", width: "default" },
    starter: `# Therapy Workbook

::: chapter number=1 title="Understanding Responses"
Introductory paragraph.
:::

::: box insight title="Insight"
A quick reflective note.
:::

::: tool number="01" title="Grounding practice"
**Purpose:** Anchor attention in the present.
**How To Use:**
- Step one
- Step two
**Journal Space:**
What did you notice?
___
:::
`,
  },
  {
    id: "cybersec",
    label: "Cybersecurity Book",
    description: "Blue-team field manual with terminal panels and severity callouts",
    icon: ShieldCheck,
    templateId: "cybersec",
    custom: { accent: "#0D9488", font: "sans", width: "wide" },
    starter: `# Blue Team Field Manual

> [!NOTE]
> Intro paragraph — what this book defends, who it is for, and how to use it.

## Threat modeling

Define what you are building, what can go wrong, and what you will do about it.

| Stage           | Signal                        | Control              |
| --------------- | ----------------------------- | -------------------- |
| Initial access  | Phishing, exposed services    | MFA, filtering       |
| Execution       | Script interpreters           | EDR, AppLocker       |

::: warning title="Containment"
Never let an incident turn into a forensic witch hunt.
:::

\`\`\`bash
# example detection
tail -F /var/log/auth.log | grep -E 'Failed|Accepted' | jq -R '{src: inputs, ts: now}'
\`\`\`
`,
  },
];

export function presetById(id: string): BookPreset | undefined {
  return BOOK_PRESETS.find((p) => p.id === id);
}