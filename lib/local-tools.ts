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
import type { Corpus } from "./corpus";
import type { Persona } from "./personas";
import { webSearch } from "./web-search";

export function createLocalTools(activeCorpus: Corpus, persona: Pick<Persona, "name" | "documentLabel">) {
  const documentLabel = persona.documentLabel || "sources";
  const personaName = persona.name;

  const searchEssays = tool({
    description:
      `Semantic search over ${personaName}'s local ${documentLabel} using local embeddings. Returns top matching chunks with title, URL, and snippet text. Use multiSearchEssays instead if the answer likely spans multiple sources.`,
    inputSchema: z.object({
      query: z.string().describe("Question or topic to search for."),
      topK: z.number().min(1).max(30).default(15).describe("Number of chunks to return."),
    }),
    execute: async ({ query, topK }) => {
      const results = await activeCorpus.search(query, topK);
      return { query, results };
    },
  });

  const multiSearchEssays = tool({
    description:
      `Run several phrasings of the same question in parallel across ${personaName}'s ${documentLabel} and merge the results. PREFERRED over searchEssays for any non-trivial question. Provide 2–5 reformulations: e.g. paraphrase, narrower variant, broader variant, related concept.`,
    inputSchema: z.object({
      queries: z
        .array(z.string())
        .min(1)
        .max(5)
        .describe("2–5 reformulations of the same underlying question."),
      topK: z.number().min(1).max(30).default(20).describe("Total chunks returned after merge."),
      maxPerEssay: z
        .number()
        .min(1)
        .max(10)
        .default(3)
        .describe("Cap chunks per source to keep the pool diverse. Default 3."),
    }),
    execute: async ({ queries, topK, maxPerEssay }) => {
      const results = await activeCorpus.multiSearch(queries, topK, maxPerEssay);
      return { queries, results };
    },
  });

  const browseEssays = tool({
    description:
      `List all available ${personaName} ${documentLabel} with title, slug, and URL. Use this to see what's indexed.`,
    inputSchema: z.object({}),
    execute: async () => {
      const manifest = await activeCorpus.browse();
      const tree = manifest.map((m) => `- ${m.title} (${m.slug}) — ${m.url}`).join("\n");
      return {
        pageCount: manifest.length,
        tree,
      };
    },
  });

  const listDirectory = tool({
    description:
      `List ${documentLabel} whose slug or title starts with a prefix. Use to filter the catalog. Pass '/' or '' for everything.`,
    inputSchema: z.object({
      path: z
        .string()
        .default("/")
        .describe("Slug prefix (e.g. 'start' matches startup-*). '/' = all."),
    }),
    execute: async ({ path }) => {
      const matches = await activeCorpus.list(path);
      return {
        path,
        total: matches.length,
        files: matches.map((m) => ({ slug: m.slug, title: m.title, url: m.url })),
      };
    },
  });

  const readEssay = tool({
    description:
      `Read the full markdown content of one ${personaName} source by its slug or path.`,
    inputSchema: z.object({
      path: z.string().describe("Source slug or path. Examples: 'startupideas', '/founders.md'."),
    }),
    execute: async ({ path }) => activeCorpus.read(path),
  });

  const grepEssays = tool({
    description:
      `Regex/literal search across ${personaName}'s ${documentLabel} using ripgrep. Use to find specific phrases or quotes. Outputs matched lines with context, file paths, or counts.`,
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern, or literal if fixedString=true."),
      path: z.string().default("/").describe("Restrict to slug prefix within local documents. '/' = all."),
      contextLines: z.number().min(0).max(10).optional().describe("Lines before AND after each match (default 3)."),
      linesAfter: z.number().min(0).max(20).optional(),
      linesBefore: z.number().min(0).max(20).optional(),
      caseSensitive: z.boolean().default(false),
      wholeWord: z.boolean().default(false),
      fixedString: z.boolean().default(false),
      maxTotalMatches: z.number().min(1).max(1000).default(100),
      outputMode: z.enum(["content", "files_with_matches", "count"]).default("content"),
    }),
    execute: async (input) => activeCorpus.grep(input),
  });

  return {
    multiSearchEssays,
    searchEssays,
    browseEssays,
    listDirectory,
    readEssay,
    grepEssays,
    webSearch,
  };
}

export const localPaulGrahamTools = createLocalTools(corpus, {
  name: "Paul Graham",
  documentLabel: "essays",
});

export const {
  multiSearchEssays,
  searchEssays,
  browseEssays,
  listDirectory,
  readEssay,
  grepEssays,
} = localPaulGrahamTools;
