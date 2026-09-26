"use client";

import { useEffect, useRef, useState } from "react";

const METRICS_KEY = "kreator-writing-daily";
const GOAL_KEY = "kreator-writing-goal";

function countSyllables(word: string): number {
  const lower = word.toLowerCase();
  const withoutE = lower.replace(/([aeiouy])e$/i, "$1");
  const groups = withoutE.match(/[aeiouy]+/g);
  return groups ? groups.length : 0;
}

function readingEase(words: number, sentences: number, syllables: number): number {
  if (words === 0 || sentences === 0) return 100;
  return (
    206.835 -
    1.015 * (words / sentences) -
    84.6 * (syllables / words)
  );
}

function easeLabel(score: number): string {
  if (score >= 90) return "Very easy";
  if (score >= 80) return "Easy";
  if (score >= 70) return "Fairly easy";
  if (score >= 60) return "Standard";
  if (score >= 50) return "Fairly difficult";
  if (score >= 30) return "Difficult";
  return "Very difficult";
}

function passageMetrics(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  const syllables = text
    .toLowerCase()
    .match(/[a-z]+/g)
    ?.reduce((sum, w) => sum + countSyllables(w), 0) ?? 0;
  return { words, sentences, syllables };
}

function readMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function WritingMetrics({
  text,
  hydrated,
}: {
  text: string;
  hydrated: boolean;
}) {
  const prevWords = useRef(0);
  const [sessionWords, setSessionWords] = useState(0);
  const [dailyWords, setDailyWords] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(METRICS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const [goal, setGoal] = useState(() => {
    if (typeof window === "undefined") return 500;
    const raw = window.localStorage.getItem(GOAL_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
  });
  const [editingGoal, setEditingGoal] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    const words = passageMetrics(text).words;
    const delta = words - prevWords.current;
    prevWords.current = words;
    if (delta <= 0) return;

    setSessionWords((prev) => prev + delta);
    setDailyWords((prev) => {
      const key = todayKey();
      const next = { ...prev, [key]: (prev[key] ?? 0) + delta };
      try {
        window.localStorage.setItem(METRICS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [text, hydrated]);

  const { words, sentences, syllables } = passageMetrics(text);
  const ease = Math.round(readingEase(words, sentences, syllables));
  const todayCount = dailyWords[todayKey()] ?? 0;
  const progress = goal > 0 ? Math.min(100, Math.round((todayCount / goal) * 100)) : 0;

  return (
    <span className="flex items-center gap-1 text-[11px] leading-none text-muted-foreground/70">
      <span className="tabular-nums" title="Words written this session">
        <span className="font-semibold text-foreground">{sessionWords}</span> sess
      </span>
      <span className="tabular-nums" title="Estimated reading time at 200 wpm">
        <span className="font-semibold text-foreground">{readMinutes(text)}</span> min
      </span>
      <span className="tabular-nums" title={`Flesch reading ease: ${ease}/100 — ${easeLabel(ease)}`}>
        <span className="font-semibold text-foreground">{ease}</span> ease
      </span>
      <span className="flex items-center gap-1 tabular-nums" title="Daily word goal">
        <button
          type="button"
          className="transition-colors hover:text-foreground"
          onClick={() => setEditingGoal((o) => !o)}
        >
          <span className="font-semibold text-foreground">{todayCount}</span>/{goal}
        </button>
        <span
          className="h-1 w-10 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <span
            className={`block h-full rounded-full ${progress >= 100 ? "bg-emerald-500" : "bg-muted-foreground"}`}
            style={{ width: `${progress}%` }}
          />
        </span>
      </span>
      {editingGoal && (
        <input
          type="number"
          min={100}
          step={100}
          value={goal}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v > 0) setGoal(v);
          }}
          onBlur={() => {
            setEditingGoal(false);
            if (goal > 0) {
              try {
                window.localStorage.setItem(GOAL_KEY, String(goal));
              } catch {
                /* ignore */
              }
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditingGoal(false);
          }}
          className="h-5 w-14 rounded border bg-background px-1 text-[11px] outline-none focus:border-ring"
          aria-label="Daily word goal"
          autoFocus
        />
      )}
    </span>
  );
}