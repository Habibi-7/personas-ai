/**
 * Corpus tests. Bun test (built-in, zero-config).
 *
 * Uses a stub Embedder (canned vectors) and a synthetic fixture index so
 * tests don't pull the real ~25MB MiniLM model.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCorpus, type ChunkEntry, type ManifestEntry } from "./corpus";
import type { Embedder } from "./embedder";

const TMP_ROOT = join(tmpdir(), `corpus-test-${process.pid}`);
const ESSAYS_DIR = join(TMP_ROOT, "essays");
const INDEX_DIR = join(TMP_ROOT, "index");

// Stub embedder: encodes the first few letters of `text` into a 4-dim vector.
// Same text in → same vector out, so search results are deterministic.
const stubEmbedder: Embedder = async (text) => {
  const v = [0, 0, 0, 0];
  for (let i = 0; i < Math.min(text.length, 4); i++) {
    v[i] = text.charCodeAt(i) / 1000;
  }
  return normalize(v);
};

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

beforeAll(async () => {
  await mkdir(ESSAYS_DIR, { recursive: true });
  await mkdir(INDEX_DIR, { recursive: true });

  // Two essays, three chunks each. "alpha" chunks match "alpha" queries best.
  const chunks: ChunkEntry[] = [
    { slug: "alpha", title: "Alpha", url: "https://x/alpha.html", chunkIdx: 0, text: "alpha one", vec: await stubEmbedder("alpha one") },
    { slug: "alpha", title: "Alpha", url: "https://x/alpha.html", chunkIdx: 1, text: "alpha two", vec: await stubEmbedder("alpha two") },
    { slug: "alpha", title: "Alpha", url: "https://x/alpha.html", chunkIdx: 2, text: "alpha three", vec: await stubEmbedder("alpha three") },
    { slug: "beta", title: "Beta", url: "https://x/beta.html", chunkIdx: 0, text: "beta one", vec: await stubEmbedder("beta one") },
    { slug: "beta", title: "Beta", url: "https://x/beta.html", chunkIdx: 1, text: "beta two", vec: await stubEmbedder("beta two") },
  ];

  const manifest: ManifestEntry[] = [
    { slug: "alpha", title: "Alpha", url: "https://x/alpha.html", chunks: 3, file: "alpha.md" },
    { slug: "beta", title: "Beta", url: "https://x/beta.html", chunks: 2, file: "beta.md" },
  ];

  await writeFile(join(INDEX_DIR, "embeddings.json"), JSON.stringify(chunks));
  await writeFile(join(INDEX_DIR, "manifest.json"), JSON.stringify(manifest));

  await writeFile(
    join(ESSAYS_DIR, "alpha.md"),
    `---\ntitle: "Alpha"\nslug: alpha\nurl: https://x/alpha.html\n---\nAlpha body content.\n`
  );
  await writeFile(
    join(ESSAYS_DIR, "beta.md"),
    `---\ntitle: "Beta"\nslug: beta\nurl: https://x/beta.html\n---\nBeta body content.\n`
  );
});

function makeCorpus() {
  return createCorpus({
    embedder: stubEmbedder,
    essaysDir: ESSAYS_DIR,
    indexDir: INDEX_DIR,
  });
}

describe("Corpus.search", () => {
  test("returns top-K hits ordered by score", async () => {
    const corpus = makeCorpus();
    const hits = await corpus.search("alpha one", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].slug).toBe("alpha");
    // Scores descending.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  test("caps chunks per essay at 2", async () => {
    const corpus = makeCorpus();
    const hits = await corpus.search("alpha", 10);
    const alphaCount = hits.filter((h) => h.slug === "alpha").length;
    expect(alphaCount).toBeLessThanOrEqual(2);
  });

  test("respects topK", async () => {
    const corpus = makeCorpus();
    const hits = await corpus.search("anything", 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});

describe("Corpus.multiSearch", () => {
  test("merges queries and dedups by chunk id", async () => {
    const corpus = makeCorpus();
    const hits = await corpus.multiSearch(["alpha one", "alpha two"], 10);
    const ids = hits.map((h) => `${h.slug}|${h.chunkIdx}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("score is max across queries", async () => {
    const corpus = makeCorpus();
    const single = await corpus.search("alpha one", 5);
    const multi = await corpus.multiSearch(["alpha one", "totally unrelated zzz"], 5);
    const topSingle = single.find((h) => h.text === "alpha one");
    const topMulti = multi.find((h) => h.text === "alpha one");
    expect(topMulti).toBeDefined();
    // Multi score must be >= single (max across queries).
    expect(topMulti!.score).toBeGreaterThanOrEqual(topSingle!.score);
  });

  test("respects per-essay cap override", async () => {
    const corpus = makeCorpus();
    const hits = await corpus.multiSearch(["alpha"], 10, 1);
    const alphaCount = hits.filter((h) => h.slug === "alpha").length;
    expect(alphaCount).toBeLessThanOrEqual(1);
  });

  test("returns empty on empty queries", async () => {
    const corpus = makeCorpus();
    expect(await corpus.multiSearch([], 5)).toEqual([]);
  });
});

describe("Corpus.read", () => {
  test("returns frontmatter title/url + stripped body", async () => {
    const corpus = makeCorpus();
    const doc = await corpus.read("alpha");
    expect(doc.title).toBe("Alpha");
    expect(doc.url).toBe("https://x/alpha.html");
    expect(doc.content).toContain("Alpha body content.");
    expect(doc.content).not.toContain("---");
  });

  test("accepts bare slug, /slug, slug.md, slug.html", async () => {
    const corpus = makeCorpus();
    for (const id of ["alpha", "/alpha", "alpha.md", "alpha.html"]) {
      const doc = await corpus.read(id);
      expect(doc.title).toBe("Alpha");
    }
  });

  test("throws on missing essay", async () => {
    const corpus = makeCorpus();
    expect(corpus.read("nonexistent")).rejects.toThrow(/not found/i);
  });
});

describe("Corpus.list / browse", () => {
  test("browse returns full manifest", async () => {
    const corpus = makeCorpus();
    const all = await corpus.browse();
    expect(all.length).toBe(2);
  });

  test("list filters by slug prefix", async () => {
    const corpus = makeCorpus();
    const out = await corpus.list("alph");
    expect(out.length).toBe(1);
    expect(out[0].slug).toBe("alpha");
  });

  test("list with '/' returns everything", async () => {
    const corpus = makeCorpus();
    expect((await corpus.list("/")).length).toBe(2);
  });
});

describe("Corpus error model", () => {
  test("throws clear error when index missing", async () => {
    const broken = createCorpus({
      embedder: stubEmbedder,
      essaysDir: ESSAYS_DIR,
      indexDir: join(TMP_ROOT, "nope"),
    });
    expect(broken.search("x", 1)).rejects.toThrow(/index missing/i);
  });
});

// Cleanup happens via OS tmp eviction; explicit rm omitted to keep failing
// test artefacts inspectable.
void rm;
