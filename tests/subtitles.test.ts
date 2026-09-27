import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_SUBTITLE_STYLE_ID,
  MAX_CHARS_PER_CUE,
  MIN_CUE_SECONDS,
  SUBTITLE_STYLES,
  subtitleStyleById,
  buildTimelineCues,
  cueAt,
  cuesForScene,
  estimateCueSeconds,
  estimateNarrationSeconds,
  plainCue,
  regionsFromWords,
  splitIntoCues,
  toSrt,
  toSrtTimestamp,
  wrapCue,
  activeWordIndex,
  cuesForSceneAligned,
  lineIndexForWord,
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

describe("estimateNarrationSeconds", () => {
  it("is zero for text with no words", () => {
    // Not the one-second floor: a scene with no line keeps the length the
    // author chose for pacing.
    assert.equal(estimateNarrationSeconds(""), 0);
    assert.equal(estimateNarrationSeconds("   "), 0);
  });

  it("is longer than the bare speaking time, for the pause at each edge", () => {
    const words = "una dos tres cuatro cinco";
    const bare = words.split(" ").length / 2.6;
    assert.ok(estimateNarrationSeconds(words) > bare);
  });

  it("grows with the word count", () => {
    const short = estimateNarrationSeconds("una dos tres");
    const long = estimateNarrationSeconds("una dos tres cuatro cinco seis siete ocho");
    assert.ok(long > short);
  });

  it("counts only words, so runs of spaces do not inflate it", () => {
    assert.equal(
      estimateNarrationSeconds("una  dos   tres"),
      estimateNarrationSeconds("una dos tres"),
    );
  });

  it("ignores leading and trailing space", () => {
    assert.equal(
      estimateNarrationSeconds("  hola mundo  "),
      estimateNarrationSeconds("hola mundo"),
    );
  });

  it("agrees with the subtitle estimate, so a sized scene holds its own captions", () => {
    // The point of sharing the speaking rate: a scene sized by this function
    // must be long enough for the cues built from the same words.
    const text = "esta es una linea de narracion bastante larga para medir";
    assert.ok(
      estimateNarrationSeconds(text) > estimateCueSeconds(text),
      "the scene must outlast the last cue",
    );
  });

  it("rounds to hundredths so a slider lands on a clean value", () => {
    const value = estimateNarrationSeconds("una dos tres cuatro cinco seis");
    assert.equal(value, Math.round(value * 100) / 100);
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
      plainCue(["Hola"], 0, 1),
      plainCue(["Mundo"], 1, 2),
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
    const srt = toSrt([plainCue(["line one", "line two"], 0, 1)]);
    assert.match(srt, /line one\nline two/);
  });
});

describe("regionsFromWords", () => {
  it("merges word runs into speech regions, skipping real gaps", () => {
    const regions = regionsFromWords([
      { start: 0.0, end: 0.5 },
      { start: 0.55, end: 1.0 }, // breath: gap 0.05 < 0.18 → merged
      { start: 2.0, end: 2.6 }, // real pause: gap 1.0 → new region
    ]);
    assert.deepEqual(regions, [
      { start: 0, end: 1.0 },
      { start: 2.0, end: 2.6 },
    ]);
  });

  it("sorts unaligned input and drops invalid entries", () => {
    const regions = regionsFromWords([
      { start: 1, end: 2 },
      { start: 0.2, end: 0.9 }, // unsorted on purpose
      { start: NaN, end: 3 }, // invalid: dropped
      { start: 0, end: 0 }, // zero-width: dropped
    ]);
    // The two valid words merge across the 0.1s breath.
    assert.deepEqual(regions, [{ start: 0.2, end: 2 }]);
  });

  it("returns no regions from no words", () => {
    assert.deepEqual(regionsFromWords([]), []);
  });
});

describe("subtitle style templates", () => {
  it("exposes six templates with unique ids and labels", () => {
    assert.ok(SUBTITLE_STYLES.length >= 6);
    const ids = new Set(SUBTITLE_STYLES.map((s) => s.id));
    assert.equal(ids.size, SUBTITLE_STYLES.length);
    for (const s of SUBTITLE_STYLES) {
      assert.ok(s.label.length > 0);
      assert.ok(["solid", "translucent", "none"].includes(s.plate));
      assert.ok(s.sizeRatio > 0);
      assert.ok(s.bottomRatio >= 0 && s.bottomRatio < 0.5);
    }
  });

  it("falls back to the default for unknown or missing ids", () => {
    assert.equal(subtitleStyleById("nope").id, DEFAULT_SUBTITLE_STYLE_ID);
    assert.equal(subtitleStyleById(undefined).id, DEFAULT_SUBTITLE_STYLE_ID);
    assert.equal(subtitleStyleById("tiktok").id, "tiktok");
  });

  it("keeps the default in the catalog", () => {
    assert.ok(SUBTITLE_STYLES.some((s) => s.id === DEFAULT_SUBTITLE_STYLE_ID));
  });
});

describe("aligned cues", () => {
  const regions = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ];

  it("times every word when a scene has measured speech", () => {
    const cues = cuesForSceneAligned("hola mundo entero", 0, regions);
    assert.ok(cues.length > 0);
    const words = cues.flatMap((c) => c.words.map((w) => w.text));
    assert.deepEqual(words, ["hola", "mundo", "entero"]);
  });

  it("puts every word inside the scene and in order", () => {
    const cues = cuesForSceneAligned("uno dos tres cuatro cinco", 0, regions);
    let last = -1;
    for (const cue of cues) {
      for (const word of cue.words) {
        assert.ok(word.start >= 0, `${word.text} starts before the scene`);
        assert.ok(word.end <= 3 + 1e-9, `${word.text} runs past the speech`);
        assert.ok(word.end >= word.start, `${word.text} is reversed`);
        assert.ok(
          word.start >= last,
          `${word.text} starts before the word before it`,
        );
        last = word.start;
      }
    }
  });

  it("does not start a word inside a pause", () => {
    const cues = cuesForSceneAligned("uno dos tres cuatro", 0, regions);
    for (const cue of cues) {
      for (const word of cue.words) {
        const inGap = word.start > 1 && word.start < 2;
        assert.equal(inGap, false, `${word.text} starts in the silence`);
      }
    }
  });

  it("shifts the whole cue by the scene offset", () => {
    const [first] = cuesForSceneAligned("hola mundo", 10, regions);
    assert.ok(first);
    assert.ok(first.start >= 10, "cue should sit after the offset");
  });

  it("points every line start at a real word in that line", () => {
    const cues = cuesForSceneAligned(
      "palabra uno palabra dos palabra tres palabra cuatro",
      0,
      regions,
    );
    for (const cue of cues) {
      assert.equal(cue.lineStarts.length, cue.lines.length);
      let previous = -1;
      for (const start of cue.lineStarts) {
        assert.ok(
          start >= 0 && start < cue.words.length,
          `line start ${start} is outside the cue`,
        );
        assert.ok(start > previous, "line starts must advance");
        previous = start;
      }
    }
  });

  it("returns nothing without words or without regions", () => {
    assert.deepEqual(cuesForSceneAligned("", 0, regions), []);
    assert.deepEqual(cuesForSceneAligned("hola", 0, []), []);
  });
});

describe("activeWordIndex", () => {
  const cue = {
    lines: ["uno dos tres"],
    start: 0,
    end: 3,
    lineStarts: [0],
    words: [
      { text: "uno", start: 0, end: 1 },
      { text: "dos", start: 1, end: 2 },
      { text: "tres", start: 2, end: 3 },
    ],
  };

  it("follows the clock through the cue", () => {
    assert.equal(activeWordIndex(cue, 0.5), 0);
    assert.equal(activeWordIndex(cue, 1.5), 1);
    assert.equal(activeWordIndex(cue, 2.5), 2);
  });

  it("holds a word through a pause instead of flickering", () => {
    // A word counts until the next one starts, so a silence right after it
    // must not switch the highlight off and on.
    assert.equal(activeWordIndex(cue, 0.99), 0);
    assert.equal(activeWordIndex(cue, 1.0), 1);
  });

  it("reports -1 before the cue and after the last word", () => {
    assert.equal(activeWordIndex(cue, -1), -1);
    assert.equal(activeWordIndex(cue, 99), 2);
  });

  it("returns -1 for a cue with no word timings", () => {
    assert.equal(activeWordIndex(plainCue(["hola"], 0, 1), 0.5), -1);
  });

  it("can resume from a known position", () => {
    // The painter keeps the previous index so a long caption is not rescanned
    // on every frame.
    assert.equal(activeWordIndex(cue, 2.5, 2), 2);
    assert.equal(activeWordIndex(cue, 0.5, 2), 0);
  });
});

describe("lineIndexForWord", () => {
  it("maps a word to the line it was painted on", () => {
    const cue = {
      lines: ["uno dos", "tres cuatro"],
      start: 0,
      end: 4,
      words: [
        { text: "uno", start: 0, end: 1 },
        { text: "dos", start: 1, end: 2 },
        { text: "tres", start: 2, end: 3 },
        { text: "cuatro", start: 3, end: 4 },
      ],
      lineStarts: [0, 2],
    };
    assert.equal(lineIndexForWord(cue, 0), 0);
    assert.equal(lineIndexForWord(cue, 1), 0);
    assert.equal(lineIndexForWord(cue, 2), 1);
    assert.equal(lineIndexForWord(cue, 3), 1);
  });

  it("returns -1 for a word outside the cue or a cue with no line data", () => {
    assert.equal(lineIndexForWord(plainCue(["hola"], 0, 1), 0), -1);
  });
});
