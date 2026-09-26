"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { categoryLabel, type QualityIssue } from "@/lib/quality-check";

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es", label: "Español" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
] as const;

type LanguageToolMatch = {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  context: { text: string; offset: number; length: number };
};

export function QualityPanel({
  issues,
  text,
  onApplyReplacement,
  onClose,
}: {
  issues: QualityIssue[];
  text: string;
  onApplyReplacement: (offset: number, length: number, replacement: string) => void;
  onClose: () => void;
}) {
  const [language, setLanguage] = useState<string>("es");
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState<LanguageToolMatch[] | null>(null);
  const [ltError, setLtError] = useState<string | null>(null);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;

  const runSpellCheck = async () => {
    setChecking(true);
    setLtError(null);
    setMatches(null);
    try {
      const params = new URLSearchParams();
      params.set("text", text);
      params.set("language", language);
      const response = await fetch(
        "https://api.languagetool.org/v2/check",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        },
      );
      if (!response.ok) throw new Error(`LanguageTool ${response.status}`);
      const data: { matches: LanguageToolMatch[] } = await response.json();
      setMatches(data.matches ?? []);
    } catch (error) {
      console.error("Spell check failed:", error);
      setLtError(
        error instanceof Error ? error.message : "Spell check failed",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="size-3.5" />
          Quality
        </span>
        {issues.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
            {errorCount > 0 ? (
              <span className="text-red-600 dark:text-red-400">{errorCount} err</span>
            ) : null}
            {errorCount > 0 && warningCount > 0 ? " · " : ""}
            {warningCount > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">{warningCount} warn</span>
            ) : null}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClose}
          aria-label="Close quality"
        >
          <X className="size-3.5" />
          Close
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {issues.length > 0 ? (
          <ul className="space-y-1.5 p-3">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="rounded border bg-background p-2 text-xs"
              >
                <span
                  className={cn(
                    "mb-0.5 flex items-center gap-1 font-medium",
                    issue.severity === "error"
                      ? "text-red-600 dark:text-red-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {issue.severity === "error" ? (
                    <AlertTriangle className="size-3.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  {categoryLabel(issue.category)}
                </span>
                <p className="text-foreground">{issue.message}</p>
                {issue.hint && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {issue.hint}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-3 py-4 text-center">
            <CheckCircle2 className="mx-auto mb-1 size-6 text-emerald-500" />
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              No issues detected
            </p>
            <p className="text-[11px] text-muted-foreground">
              Headings, tables, links, boxes and figures look clean.
            </p>
          </div>
        )}

        <div className="border-t bg-muted/30 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Spelling & grammar
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Spell-check language"
              className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:border-ring"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={runSpellCheck}
              disabled={checking || text.trim() === ""}
            >
              {checking ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Check"
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Free LanguageTool API — the current editor text is checked locally
            before export.
          </p>

          {ltError && (
            <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-600 dark:text-red-400">
              {ltError}
            </p>
          )}
          {matches && matches.length === 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              No spelling or grammar issues found.
            </p>
          )}
          {matches && matches.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {matches.map((match, index) => {
                const start =
                  match.context.offset - Math.max(0, match.context.offset - 0);
                void start;
                const before =
                  match.context.text
                    .slice(0, match.context.offset - (match.offset - 0))
                    .slice(-32) || "";
                const after =
                  match.context.text.slice(
                    match.context.offset + match.context.length,
                  ) || "";
                return (
                  <li
                    key={index}
                    className="rounded border bg-background p-2 text-xs"
                  >
                    <p className="text-foreground">
                      {match.message}
                      {match.shortMessage &&
                        match.shortMessage !== match.message && (
                          <span className="text-muted-foreground">
                            {" "}
                            — {match.shortMessage}
                          </span>
                        )}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {before}
                      <mark className="rounded bg-amber-400/40 px-0.5 text-amber-900">
                        {match.context.text.slice(
                          match.context.offset,
                          match.context.offset + match.context.length,
                        )}
                      </mark>
                      {after}
                    </p>
                    {match.replacements.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {match.replacements.slice(0, 3).map((repl) => (
                          <button
                            key={repl.value}
                            type="button"
                            onClick={() =>
                              onApplyReplacement(
                                match.offset,
                                match.length,
                                repl.value,
                              )
                            }
                            className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:bg-muted"
                          >
                            {repl.value}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}