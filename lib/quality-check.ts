export type QualityCategory =
  | "heading"
  | "box"
  | "table"
  | "link"
  | "figure";

export type QualityIssue = {
  id: string;
  category: QualityCategory;
  severity: "error" | "warning";
  message: string;
  hint?: string;
};

const CATEGORY_LABEL: Record<QualityCategory, string> = {
  heading: "Orphan heading",
  box: "Unclosed box",
  table: "Broken table",
  link: "Dead link",
  figure: "Missing figure",
};

export function categoryLabel(category: QualityCategory): string {
  return CATEGORY_LABEL[category];
}

/**
 * Heading hierarchy check: a heading whose level jumps more than one level
 * below the previous one (e.g. an `h3` directly after an `h1`) is orphaned.
 */
function checkHeadingHierarchy(html: string): QualityIssue[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings = Array.from(
    doc.body.querySelectorAll("h1, h2, h3, h4, h5, h6"),
  );
  const issues: QualityIssue[] = [];
  let lastLevel = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (lastLevel > 0 && level - lastLevel > 1) {
      const text = (h.textContent ?? "").trim().slice(0, 60);
      issues.push({
        id: `heading-${issues.length}-${level}`,
        category: "heading",
        severity: "warning",
        message: `Heading level jumps from H${lastLevel} to H${level}${text ? ` (“${text}”)` : ""}.`,
        hint: `Add a missing H${lastLevel + 1} between them, or lower it to H${lastLevel + 1}.`,
      });
    }
    if (level > lastLevel) lastLevel = level;
  }
  return issues;
}

/** Tag-balance check for HTML tables (counts opening/closing tags). */
function checkTableBalance(html: string): QualityIssue[] {
  const tableMatchers: { tag: string; close: string }[] = [
    { tag: "<table", close: "</table>" },
    { tag: "<tr", close: "</tr>" },
    { tag: "<td", close: "</td>" },
    { tag: "<th", close: "</th>" },
  ];
  const issues: QualityIssue[] = [];
  for (const { tag, close } of tableMatchers) {
    const open = (html.match(new RegExp(tag + "(?=[\\s>])", "gi")) ?? [])
      .length;
    const closed = (html.match(new RegExp(close, "gi")) ?? []).length;
    if (open === 0 || open !== closed) {
      issues.push({
        id: `table-${tag.replace(/\W/g, "")}`,
        category: "table",
        severity: "error",
        message: `${open} “${tag.trim()}” but ${closed} “${close}”.`,
        hint: "Unbalanced table markup — the table may render incorrectly.",
      });
    }
  }
  return issues;
}

/** Internal links pointing to an id that does not exist in the document. */
function checkDeadLinks(html: string): QualityIssue[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();
  doc.body.querySelectorAll("[id]").forEach((el) => {
    const id = el.getAttribute("id");
    if (id) ids.add(id);
  });
  const issues: QualityIssue[] = [];
  doc.body.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("#") || href === "#") return;
    const target = href.slice(1);
    if (!ids.has(target)) {
      issues.push({
        id: `link-${target}`,
        category: "link",
        severity: "error",
        message: `Link “#${target}” has no matching target.`,
        hint: "Add an id or fix the href.",
      });
    }
  });
  return issues;
}

/** Unclosed `:::` directive boxes in the Markdown source. */
function checkUnclosedBoxes(markdown: string): QualityIssue[] {
  const lines = markdown.split("\n");
  const stack: string[] = [];
  const OPEN = /^:::\s*([a-zA-Z][\w-]*)/;
  const issues: QualityIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith(":::")) continue;
    const match = OPEN.exec(line);
    if (match && !/^:::\s*$/.test(line)) {
      stack.push(match[1]);
    } else if (stack.length > 0) {
      stack.pop();
    } else {
      issues.push({
        id: `box-close-${i}`,
        category: "box",
        severity: "error",
        message: `Closing “:::” on line ${i + 1} has no open box.`,
      });
    }
  }
  if (stack.length > 0) {
    const innermost = stack[stack.length - 1];
    issues.push({
      id: `box-open-${innermost}`,
      category: "box",
      severity: "error",
      message: `“::: ${innermost}” is never closed (${stack.length} open).`,
      hint: "Add a closing “:::” line.",
    });
  }
  return issues;
}

/**
 * Cross-references to figures ("Figure 3.2" or "Figura 4.1") whose rendered
 * `<figure id="figure-…">` does not exist in the document.
 */
function checkFigureReferences(html: string): QualityIssue[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const ids = new Set<string>();
  doc.body.querySelectorAll("[id]").forEach((el) => {
    const id = el.getAttribute("id") ?? "";
    if (/^figure-\d+-\d+$/.test(id)) ids.add(id);
  });
  const text = (doc.body.textContent ?? "").replace(/\s+/g, " ");
  const re = /\b(?:Figure|Figura)\s+(\d{1,3})\.(\d{1,3})\b/gi;
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = `${m[1]}.${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const expectedId = `figure-${m[1]}-${m[2]}`;
    if (!ids.has(expectedId)) {
      issues.push({
        id: `figure-${key}`,
        category: "figure",
        severity: "warning",
        message: `Referenced “${m[0].trim()}” but no figure with id “${expectedId}” exists.`,
        hint: "Add the image/caption or fix the reference.",
      });
    }
  }
  return issues;
}

export function checkQuality(markdown: string, html: string): QualityIssue[] {
  if (typeof DOMParser === "undefined") return [];
  return [
    ...checkUnclosedBoxes(markdown),
    ...checkHeadingHierarchy(html),
    ...checkTableBalance(html),
    ...checkDeadLinks(html),
    ...checkFigureReferences(html),
  ];
}