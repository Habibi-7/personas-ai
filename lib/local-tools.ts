/**
 * Tool surface for the chat route. Thin Zod adapters over the Corpus seam.
 *
 * Each tool here is < 15 lines: parse input → call corpus.* → return.
 * All retrieval logic lives in lib/corpus.ts. Web search is its own module
 * (lib/web-search.ts) — not part of the Corpus.
 *
 * See CONTEXT.md for terminology.
 */
import { tool } from "ai";
import { z } from "zod";
import { corpus } from "./corpus";
import { webSearch } from "./web-search";

export const searchEssays = tool({
  description:
    "Semantic search over Paul Graham's essays using local embeddings. Returns top matching chunks with title, URL, and snippet text.",
  inputSchema: z.object({
    query: z.string().describe("Question or topic to search for."),
    topK: z.number().min(1).max(20).default(8).describe("Number of chunks to return."),
  }),
  execute: async ({ query, topK }) => {
    const results = await corpus.search(query, topK);
    return { query, results };
  },
});

export const browseEssays = tool({
  description:
    "List all available Paul Graham essays with title, slug, and URL. Use this to see what's indexed.",
  inputSchema: z.object({}),
  execute: async () => {
    const manifest = await corpus.browse();
    const tree = manifest.map((m) => `- ${m.title} (${m.slug}) — ${m.url}`).join("\n");
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
    const matches = await corpus.list(path);
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
  execute: async ({ path }) => corpus.read(path),
});

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
    outputMode: z.enum(["content", "files_with_matches", "count"]).default("content"),
  }),
  execute: async (input) => corpus.grep(input),
});

export const localPaulGrahamTools = {
  searchEssays,
  browseEssays,
  listDirectory,
  readEssay,
  grepEssays,
  webSearch,
};
