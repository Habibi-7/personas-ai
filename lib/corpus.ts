/**
 * Corpus — the single seam for all queries against the Essay corpus.
 *
 * See CONTEXT.md → Corpus, Essay, Chunk, Manifest, Index, Embedder.
 *
 * The Corpus is the test surface. Tool definitions in lib/local-tools.ts are
 * thin Zod adapters over these methods. The build script and any future eval
 * harness share the same interface.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Embedder } from "./embedder";

// ---------- public types ----------

export type ChunkEntry = {
  slug: string;
  title: string;
  url: string;
  chunkIdx: number;
  text: string;
  vec: number[];
};

export type ManifestEntry = {
  slug: string;
  title: string;
  url: string;
  chunks: number;
  file: string;
};

export type SearchHit = {
  slug: string;
  title: string;
  url: string;
  score: number;
  chunkIdx: number;
  text: string;
};

export type EssayDoc = {
  path: string;
  title: string;
  url: string;
  content: string;
};

export type GrepArgs = {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  fixedString?: boolean;
  linesAfter?: number;
  linesBefore?: number;
  contextLines?: number;
  maxTotalMatches?: number;
  outputMode?: "content" | "files_with_matches" | "count";
};

export type GrepResult = {
  pattern: string;
  pathFilter: string;
  outputMode: GrepArgs["outputMode"];
  output: string;
  lineCount: number;
};

export type CorpusDeps = {
  embedder: Embedder;
  essaysDir: string;
  indexDir: string;
  /** Max chunks returned per essay in `search()`. Default 2. */
  maxChunksPerEssay?: number;
  /** ripgrep binary, override for tests. Default "rg". */
  ripgrepBin?: string;
};

export type Corpus = {
  search(query: string, topK: number): Promise<SearchHit[]>;
  /**
   * Run several phrasings of a question in parallel; merge results by chunk
   * id keeping the highest score, then apply the per-essay cap, then truncate
   * to topK. Lifts recall when the user question and the essay's wording
   * disagree.
   */
  multiSearch(queries: string[], topK: number, maxPerEssay?: number): Promise<SearchHit[]>;
  read(slugOrPath: string): Promise<EssayDoc>;
  list(prefix: string): Promise<ManifestEntry[]>;
  browse(): Promise<ManifestEntry[]>;
  grep(args: GrepArgs): Promise<GrepResult>;
  /** Eagerly load index + warm embedder. Optional; methods do it lazily. */
  warmup(): Promise<void>;
};

// ---------- factory ----------

export function createCorpus(deps: CorpusDeps): Corpus {
  const { embedder, essaysDir, indexDir } = deps;
  const maxChunksPerEssay = deps.maxChunksPerEssay ?? 2;
  const ripgrepBin = deps.ripgrepBin ?? "rg";

  let chunksPromise: Promise<ChunkEntry[]> | null = null;
  let manifestPromise: Promise<ManifestEntry[]> | null = null;

  function loadChunks(): Promise<ChunkEntry[]> {
    if (!chunksPromise) {
      const file = join(indexDir, "embeddings.json");
      if (!existsSync(file)) {
        return Promise.reject(
          new Error(`Corpus index missing at ${file} — run \`bun run index\`.`)
        );
      }
      chunksPromise = readFile(file, "utf8").then((s) => JSON.parse(s) as ChunkEntry[]);
    }
    return chunksPromise;
  }

  function loadManifest(): Promise<ManifestEntry[]> {
    if (!manifestPromise) {
      const file = join(indexDir, "manifest.json");
      if (!existsSync(file)) {
        return Promise.reject(
          new Error(`Corpus manifest missing at ${file} — run \`bun run index\`.`)
        );
      }
      manifestPromise = readFile(file, "utf8").then((s) => JSON.parse(s) as ManifestEntry[]);
    }
    return manifestPromise;
  }

  return {
    async search(query, topK) {
      const [chunks, qvec] = await Promise.all([loadChunks(), embedder(query)]);
      const scored = chunks.map((c) => ({ score: cosine(qvec, c.vec), c }));
      return rankWithCap(scored, topK, maxChunksPerEssay);
    },

    async multiSearch(queries, topK, maxPerEssay) {
      if (queries.length === 0) return [];
      const [chunks, qvecs] = await Promise.all([
        loadChunks(),
        Promise.all(queries.map((q) => embedder(q))),
      ]);
      // For each chunk, score = max cosine across all query vectors.
      const scored = chunks.map((c) => {
        let best = -Infinity;
        for (const qv of qvecs) {
          const s = cosine(qv, c.vec);
          if (s > best) best = s;
        }
        return { score: best, c };
      });
      return rankWithCap(scored, topK, maxPerEssay ?? maxChunksPerEssay);
    },

    async read(slugOrPath) {
      const file = slugToFile(slugOrPath);
      const full = join(essaysDir, file);
      if (!existsSync(full)) throw new Error(`Essay not found: ${file}`);
      const raw = await readFile(full, "utf8");
      const { fm, body } = parseFrontmatter(raw);
      return {
        path: file,
        title: fm.title || file,
        url: fm.url || "",
        content: body,
      };
    },

    async list(prefix) {
      const manifest = await loadManifest();
      const p = prefix.replace(/^\/+/, "").toLowerCase();
      if (!p) return manifest;
      return manifest.filter(
        (m) =>
          m.slug.toLowerCase().startsWith(p) ||
          m.title.toLowerCase().startsWith(p)
      );
    },

    async browse() {
      return loadManifest();
    },

    async grep(args) {
      const output = await runRipgrep(args, essaysDir, ripgrepBin);
      const lineCount = output.split("\n").filter(Boolean).length;
      return {
        pattern: args.pattern,
        pathFilter: args.path ?? "/",
        outputMode: args.outputMode ?? "content",
        output,
        lineCount,
      };
    },

    async warmup() {
      await Promise.all([loadChunks(), loadManifest(), embedder("warmup")]);
    },
  };
}

// ---------- internals ----------

function rankWithCap(
  scored: Array<{ score: number; c: ChunkEntry }>,
  topK: number,
  maxPerEssay: number
): SearchHit[] {
  scored.sort((a, b) => b.score - a.score);
  const perEssay = new Map<string, number>();
  const hits: SearchHit[] = [];
  for (const { score, c } of scored) {
    const n = perEssay.get(c.slug) ?? 0;
    if (n >= maxPerEssay) continue;
    perEssay.set(c.slug, n + 1);
    hits.push({
      slug: c.slug,
      title: c.title,
      url: c.url,
      score: Number(score.toFixed(4)),
      chunkIdx: c.chunkIdx,
      text: c.text,
    });
    if (hits.length >= topK) break;
  }
  return hits;
}

function cosine(a: number[], b: number[]): number {
  // Vectors are pre-normalized → dot product = cosine similarity.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function slugToFile(slug: string): string {
  // Accept ".md", ".html", "/foo.md", or bare "foo".
  let s = slug.trim().replace(/^\/+/, "");
  if (s.endsWith(".html")) s = s.replace(/\.html$/, "");
  if (!s.endsWith(".md")) s = `${s}.md`;
  return s;
}

function parseFrontmatter(content: string): {
  fm: { title?: string; url?: string; slug?: string };
  body: string;
} {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    fm[mm[1]] = v;
  }
  return { fm, body: m[2] };
}

function runRipgrep(args: GrepArgs, essaysDir: string, bin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const a: string[] = ["--no-heading", "--with-filename", "--line-number"];
    if (!args.caseSensitive) a.push("-i");
    if (args.wholeWord) a.push("-w");
    if (args.fixedString) a.push("-F");
    if (args.outputMode === "files_with_matches") a.push("-l");
    else if (args.outputMode === "count") a.push("-c");
    else {
      const A = args.linesAfter ?? args.contextLines ?? 3;
      const B = args.linesBefore ?? args.contextLines ?? 3;
      a.push("-A", String(A), "-B", String(B));
    }
    if (args.maxTotalMatches) a.push("-m", String(args.maxTotalMatches));
    a.push("-e", args.pattern);

    let target = essaysDir;
    if (args.path && args.path !== "/" && args.path !== "") {
      const sub = args.path.replace(/^\/+/, "");
      const candidate = join(essaysDir, sub);
      if (candidate.startsWith(essaysDir)) target = candidate;
    }
    a.push(target);

    const proc = spawn(bin, a);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      // rg exits 1 when no matches; not an error.
      if (code === 0 || code === 1) resolve(stdout);
      else reject(new Error(`ripgrep exit ${code}: ${stderr}`));
    });
  });
}

// ---------- default singleton for app code ----------

import { xenovaMiniLM } from "./embedder";

const ESSAYS_DIR = join(process.cwd(), "data", "essays");
const INDEX_DIR = join(process.cwd(), "data", "index");

export const corpus: Corpus = createCorpus({
  embedder: xenovaMiniLM(),
  essaysDir: ESSAYS_DIR,
  indexDir: INDEX_DIR,
});
