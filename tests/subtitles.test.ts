import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_CHARS_PER_CUE,
  MIN_CUE_SECONDS,
  buildTimelineCues,
  cueAt,
  cuesForScene,
  estimateCueSeconds,
  splitIntoCues,
  toSrt,
  toSrtTimestamp,
  wrapCue,
} from "../lib/subtitles.ts";

describe("splitIntoCues", () => {
  it("returns nothing for empty or blank text", () => {
    for (const input of ["", "   ", "\n\t "]) {
      assert.deepEqual(splitIntoCues(input), []);
    }
  });

  it("keeps a short line as a single cue", () => {
    assert.deepEqual(splitIntoCues("Hola mundo"), ["Hola mundo"]);
  });

  it("normalizes runs of whitespace", () => {
    assert.deepEqual(splitIntoCues("  hola \n\n  mundo  "), ["hola mundo"]);
  });

  it("never drops a word, however long the text", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`);
    const cues = splitIntoCues(words.join(" "));
    const rejoined = cues.join(" ").split(" ");
    assert.deepEqual(rejoined, words);
  });

  it("keeps every cue within the reading width", () => {
    const text = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(" ");
    for (const cue of splitIntoCues(text)) {
      assert.ok(
        cue.length <= MAX_CHARS_PER_CUE,
        `cue of ${cue.length} chars exceeds ${MAX_CHARS_PER_CUE}`,
      );
    }
  });

  it("breaks on a sentence boundary rather than mid-sentence", () => {
    const text =
      "Primera frase completa aqui. Segunda frase que continua un poco mas larga.";
    const cues = splitIntoCues(text);
    assert.ok(cues.length > 1);
    assert.match(cues[0]!, /Primera frase completa aqui\.$/);
  });

  it("carries a trailing clause down instead of orphaning it", () => {
    const text = "Uno dos tres cuatro cinco seis siete, y ocho nueve diez once doce.";
    const cues = splitIntoCues(text);
    for (const cue of cues) {
      assert.ok(!/,$/.test(cue), `cue ends on a dangling comma: "${cue}"`);
    }
  });
});

describe("wrapCue", () => {
  it("leaves short text on one line", () => {
    assert.deepEqual(wrapCue("Hola"), ["Hola"]);
  });

  it("returns nothing for empty text", () => {
    assert.deepEqual(wrapCue(""), []);
  });

  it("balances a long cue into two lines", () => {
    const text = "uno dos tres cuatro cinco seis siete ocho nueve diez once";
    const lines = wrapCue(text);
    assert.ok(lines.length <= 2, `got ${lines.length} lines`);
    assert.equal(lines.join(" "), text);
  });
});

describe("estimateCueSeconds", () => {
  it("has a floor so short cues do not flash past", () => {
    assert.equal(estimateCueSeconds("hola"), MIN_CUE_SECONDS);
    assert.equal(estimateCueSeconds(""), MIN_CUE_SECONDS);
  });

  it("grows with the word count", () => {
    const short = estimateCueSeconds("una dos tres");
    const long = estimateCueSeconds("una dos tres cuatro cinco seis siete ocho");
    assert.ok(long > short);
  });
});

describe("cuesForScene", () => {
  it("returns nothing when the scene has no narration", () => {
    assert.deepEqual(cuesForScene("", 0, 5), []);
    assert.deepEqual(cuesForScene("   ", 0, 5), []);
  });

  it("offsets the cues by the scene start", () => {
    const cues = cuesForScene("Hola mundo", 10, 4);
    assert.equal(cues.length, 1);
    assert.equal(cues[0]?.start, 10);
    assert.equal(cues[0]?.end, 14);
  });

  it("keeps every cue inside the scene slice", () => {
    const narration = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ");
    const cues = cuesForScene(narration, 3, 8);
    for (const cue of cues) {
      assert.ok(cue.start >= 3, `starts at ${cue.start}, before the scene`);
      assert.ok(cue.end <= 11, `ends at ${cue.end}, after the scene`);
    }
  });

  it("stays within the scene when the narration is far too long to read", () => {
    const narration = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const cues = cuesForScene(narration, 0, 2);
    assert.ok(cues.length > 1);
    for (const cue of cues) {
      assert.ok(cue.end <= 2, `ends at ${cue.end}, past the 2s scene`);
    }
  });

  it("still shows a cue for a zero-length scene", () => {
    const cues = cuesForScene("Hola", 5, 0);
    assert.equal(cues.length, 1);
    assert.equal(cues[0]?.start, 5);
  });

  it("runs the last cue to the end of the scene", () => {
    const cues = cuesForScene("Un par de frases. Y otra frase aqui.", 0, 10);
    assert.equal(cues[cues.length - 1]?.end, 10);
  });

  it("never emits a zero-length or inverted cue", () => {
    const narration = "Uno. Dos. Tres. Cuatro. Cinco. Seis. Siete. Ocho.";
    for (const cue of cuesForScene(narration, 0, 3)) {
      assert.ok(cue.end > cue.start, `cue ends at ${cue.end} but starts at ${cue.start}`);
    }
  });
});

describe("buildTimelineCues", () => {
  it("offsets each scene by the cumulative duration", () => {
    const cues = buildTimelineCues([
      { narration: "Primera", duration: 4 },
      { narration: "Segunda", duration: 6 },
    ]);
    assert.equal(cues.length, 2);
    assert.equal(cues[0]?.start, 0);
    assert.equal(cues[0]?.end, 4);
    assert.equal(cues[1]?.start, 4);
    assert.equal(cues[1]?.end, 10);
  });

  it("produces nothing for an empty timeline", () => {
    assert.deepEqual(buildTimelineCues([]), []);
  });

  it("does not bleed one scene's text into the next", () => {
    const cues = buildTimelineCues([
      { narration: "Solo la primera", duration: 2 },
      { narration: "Solo la segunda", duration: 2 },
    ]);
    for (const cue of cues) {
      const text = cue.lines.join(" ");
      assert.ok(
        text.startsWith("Solo la primera") || text.startsWith("Solo la segunda"),
        `unexpected cue text: "${text}"`,
      );
    }
  });
});

describe("cueAt", () => {
  it("finds the cue covering a time", () => {
    const cues = buildTimelineCues([
      { narration: "Uno", duration: 2 },
      { narration: "Dos", duration: 2 },
    ]);
    assert.equal(cueAt(cues, 0.5)?.lines[0], "Uno");
    assert.equal(cueAt(cues, 3)?.lines[0], "Dos");
  });

  it("returns null between and after the cues", () => {
    const cues = cuesForScene("Hola", 0, 2);
    assert.equal(cueAt(cues, 5), null);
    assert.equal(cueAt([], 0), null);
  });
});

describe("toSrtTimestamp", () => {
  it("formats as HH:MM:SS,mmm", () => {
    assert.equal(toSrtTimestamp(0), "00:00:00,000");
    assert.equal(toSrtTimestamp(1.5), "00:00:01,500");
    assert.equal(toSrtTimestamp(61.25), "00:01:01,250");
    assert.equal(toSrtTimestamp(3661.125), "01:01:01,125");
  });

  it("clamps negatives to zero", () => {
    assert.equal(toSrtTimestamp(-5), "00:00:00,000");
  });
});

describe("toSrt", () => {
  it("emits 1-based blocks with a blank line between them", () => {
    const srt = toSrt([
      { lines: ["Hola"], start: 0, end: 1 },
      { lines: ["Mundo"], start: 1, end: 2 },
    ]);
    assert.equal(
      srt,
      "1\n00:00:00,000 --> 00:00:01,000\nHola\n\n2\n00:00:01,000 --> 00:00:02,000\nMundo\n",
    );
  });

  it("is an empty string with no cues", () => {
    assert.equal(toSrt([]), "");
  });

  it("keeps a two-line cue on two lines", () => {
    const srt = toSrt([{ lines: ["line one", "line two"], start: 0, end: 1 }]);
    assert.match(srt, /line one\nline two/);
  });
});
