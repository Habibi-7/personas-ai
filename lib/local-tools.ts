import { tool } from "ai";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

/**
 * Local replacements for the Nia API tools.
 *
 * Backed by:
 *   - data/essays/*.md          (scraped essay corpus)
 *   - data/index/embeddings.json (chunk vectors, transformers.js MiniLM)
 *   - data/index/manifest.json   (per-essay metadata)
 *   - ripgrep                    (fast regex over the corpus)
 *   - Tavily HTTP API            (web search)
 */

const ESSAYS_DIR = join(process.cwd(), "data", "essays");
const INDEX_DIR = join(process.cwd(), "data", "index");
const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

const log = {
  tool: (name: string, input: unknown) => {
    console.log(`\n🔧 [LOCAL TOOL] ${name}`);
    console.log(`   Input:`, JSON.stringify(input, null, 2).split("\n").join("\n   "));
  },
  success: (name: string, summary: string) => {
    console.log(`✅ [LOCAL SUCCESS] ${name}: ${summary}`);
  },
  error: (name: string, error: string) => {
    console.error(`❌ [LOCAL ERROR] ${name}: ${error}`);
  },
};

// ---------- index loading (singletons) ----------

type ChunkEntry = {
  slug: string;
  title: string;
  url: string;
  chunkIdx: number;
  text: string;
  vec: number[];
};
type ManifestEntry = {
  slug: string;
  title: string;
  url: string;
  chunks: number;
  file: string;
};

let chunksPromise: Promise<ChunkEntry[]> | null = null;
let manifestPromise: Promise<ManifestEntry[]> | null = null;
let embedderPromise: Promise<(text: string) => Promise<number[]>> | null = null;

function loadChunks(): Promise<ChunkEntry[]> {
  if (!chunksPromise) {
    chunksPromise = readFile(join(INDEX_DIR, "embeddings.json"), "utf8").then(
      (s) => JSON.parse(s) as ChunkEntry[]
    );
  }
  return chunksPromise;
}

function loadManifest(): Promise<ManifestEntry[]> {
  if (!manifestPromise) {
    manifestPromise = readFile(join(INDEX_DIR, "manifest.json"), "utf8").then(
      (s) => JSON.parse(s) as ManifestEntry[]
    );
  }
  return manifestPromise;
}

async function getEmbedder(): Promise<(text: string) => Promise<number[]>> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = false;
      const pipe = await pipeline("feature-extraction", EMBED_MODEL);
      return async (text: string) => {
        const out = await pipe(text, { pooling: "mean", normalize: true });
        return Array.from(out.data as Float32Array);
      };
    })();
  }
  return embedderPromise;
}

function cosine(a: number[], b: number[]): number {
  // Vectors are pre-normalized -> dot product = cosine similarity.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------- path helpers ----------

function slugToFile(slug: string): string {
  // Accept ".md", ".html", "/foo.md", or bare "foo".
  let s = slug.trim().replace(/^\/+/, "");
  if (s.endsWith(".html")) s = s.replace(/\.html$/, "");
  if (!s.endsWith(".md")) s = `${s}.md`;
  return s;
}

// ---------- tools ----------

export const searchEssays = tool({
  description:
    "Semantic search over Paul Graham's essays using local embeddings. Returns top matching chunks with title, URL, and snippet text.",
  inputSchema: z.object({
    query: z.string().describe("Question or topic to search for."),
    topK: z.number().min(1).max(20).default(8).describe("Number of chunks to return."),
  }),
  execute: async ({ query, topK }) => {
    log.tool("searchEssays", { query, topK });
    const [chunks, embed] = await Promise.all([loadChunks(), getEmbedder()]);
    const qvec = await embed(query);
    const scored = chunks.map((c) => ({ score: cosine(qvec, c.vec), c }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    // Deduplicate per essay if same essay appears many times; keep top 2 chunks per essay.
    const perEssay = new Map<string, number>();
    const filtered: typeof top = [];
    for (const t of top) {
      const n = perEssay.get(t.c.slug) || 0;
      if (n >= 2) continue;
      perEssay.set(t.c.slug, n + 1);
      filtered.push(t);
    }

    const results = filtered.map(({ score, c }) => ({
      slug: c.slug,
      title: c.title,
      url: c.url,
      score: Number(score.toFixed(4)),
      chunkIdx: c.chunkIdx,
      text: c.text,
    }));
    log.success("searchEssays", `${results.length} hits, top score ${results[0]?.score ?? 0}`);
    return { query, results };
  },
});

export const browseEssays = tool({
  description:
    "List all available Paul Graham essays with title, slug, and URL. Use this to see what's indexed.",
  inputSchema: z.object({}),
  execute: async () => {
    log.tool("browseEssays", {});
    const manifest = await loadManifest();
    const tree = manifest
      .map((m) => `- ${m.title} (${m.slug}) — ${m.url}`)
      .join("\n");
    log.success("browseEssays", `${manifest.length} essays`);
    return {
      pageCount: manifest.length,
      baseUrl: "https://www.paulgraham.com",
      tree,
    };
  },
});

export const listDirectory = tool({
  description:
    "List essays whose slug or title starts with a prefix. Use to filter the catalog. Pass '/' or '' for everything.",
  inputSchema: z.object({
    path: z
      .string()
      .default("/")
      .describe("Slug prefix (e.g. 'start' matches startup-*, 'startupideas'). '/' = all."),
  }),
  execute: async ({ path }) => {
    log.tool("listDirectory", { path });
    const manifest = await loadManifest();
    const prefix = path.replace(/^\/+/, "").toLowerCase();
    const matches = prefix
      ? manifest.filter(
          (m) =>
            m.slug.toLowerCase().startsWith(prefix) ||
            m.title.toLowerCase().startsWith(prefix)
        )
      : manifest;
    log.success("listDirectory", `${matches.length} matches`);
    return {
      path,
      total: matches.length,
      files: matches.map((m) => ({ slug: m.slug, title: m.title, url: m.url })),
    };
  },
});

export const readEssay = tool({
  description:
    "Read the full markdown content of a Paul Graham essay by its slug (e.g. 'startupideas') or path (e.g. '/startupideas.md').",
  inputSchema: z.object({
    path: z.string().describe("Essay slug or path. Examples: 'startupideas', '/founders.md'."),
  }),
  execute: async ({ path }) => {
    log.tool("readEssay", { path });
    const file = slugToFile(path);
    const full = join(ESSAYS_DIR, file);
    if (!existsSync(full)) {
      log.error("readEssay", `not found: ${file}`);
      throw new Error(`Essay not found: ${file}`);
    }
    const content = await readFile(full, "utf8");
    // strip frontmatter for the agent (keep title/url separately)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const body = fmMatch ? fmMatch[2] : content;
    const fm: Record<string, string> = {};
    if (fmMatch) {
      for (const line of fmMatch[1].split("\n")) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
        fm[m[1]] = v;
      }
    }
    log.success("readEssay", `${body.length} chars from ${file}`);
    return {
      path: file,
      title: fm.title || file,
      url: fm.url || "",
      content: body,
    };
  },
});

type GrepArgs = {
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

function runRipgrep(args: GrepArgs): Promise<string> {
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

    // Restrict path inside essays dir
    let target = ESSAYS_DIR;
    if (args.path && args.path !== "/" && args.path !== "") {
      const sub = args.path.replace(/^\/+/, "");
      const candidate = join(ESSAYS_DIR, sub);
      // Prevent escape
      if (candidate.startsWith(ESSAYS_DIR)) target = candidate;
    }
    a.push(target);

    const proc = spawn("rg", a);
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

export const grepEssays = tool({
  description:
    "Regex/literal search across Paul Graham's essays using ripgrep. Use to find specific phrases or quotes. Outputs matched lines with context, file paths, or counts.",
  inputSchema: z.object({
    pattern: z.string().describe("Regex pattern, or literal if fixedString=true."),
    path: z.string().default("/").describe("Restrict to slug prefix within data/essays. '/' = all."),
    contextLines: z.number().min(0).max(10).optional().describe("Lines before AND after each match (default 3)."),
    linesAfter: z.number().min(0).max(20).optional(),
    linesBefore: z.number().min(0).max(20).optional(),
    caseSensitive: z.boolean().default(false),
    wholeWord: z.boolean().default(false),
    fixedString: z.boolean().default(false),
    maxTotalMatches: z.number().min(1).max(1000).default(100),
    outputMode: z
      .enum(["content", "files_with_matches", "count"])
      .default("content"),
  }),
  execute: async (input) => {
    log.tool("grepEssays", input);
    try {
      const out = await runRipgrep(input);
      const lines = out.split("\n").filter(Boolean);
      log.success("grepEssays", `${lines.length} output lines`);
      return {
        pattern: input.pattern,
        pathFilter: input.path,
        outputMode: input.outputMode,
        output: out,
        lineCount: lines.length,
      };
    } catch (e) {
      log.error("grepEssays", (e as Error).message);
      throw e;
    }
  },
});

export const webSearch = tool({
  description:
    "Web search via Tavily for information not in Paul Graham's essays (recent events, external context). Use sparingly.",
  inputSchema: z.object({
    query: z.string(),
    numResults: z.number().min(1).max(10).default(5),
  }),
  execute: async ({ query, numResults }) => {
    log.tool("webSearch", { query, numResults });
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
      log.error("webSearch", "TAVILY_API_KEY not set");
      return { results: [], error: "TAVILY_API_KEY not configured" };
    }
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: numResults,
        search_depth: "basic",
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      log.error("webSearch", `${res.status} ${t}`);
      throw new Error(`Tavily error: ${t}`);
    }
    const data = await res.json();
    log.success("webSearch", `${data.results?.length ?? 0} results`);
    return {
      query,
      results: (data.results ?? []).map((r: { title: string; url: string; content: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
    };
  },
});

export const getSourceContent = tool({
  description:
    "Retrieve full content of an essay by slug. Equivalent to readEssay; provided for compatibility.",
  inputSchema: z.object({
    sourceIdentifier: z.string().describe("Essay slug or filename (e.g. 'startupideas')."),
  }),
  execute: async ({ sourceIdentifier }) => {
    log.tool("getSourceContent", { sourceIdentifier });
    const file = slugToFile(sourceIdentifier);
    const full = join(ESSAYS_DIR, file);
    if (!existsSync(full)) throw new Error(`Not found: ${file}`);
    const content = await readFile(full, "utf8");
    return { success: true, content, identifier: file };
  },
});

export const localPaulGrahamTools = {
  searchEssays,
  browseEssays,
  listDirectory,
  readEssay,
  grepEssays,
  webSearch,
  getSourceContent,
};
