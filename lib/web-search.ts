/**
 * Web search adapter (Tavily). Not part of the Corpus — external HTTP API.
 * See CONTEXT.md → Web search.
 */
import { tool } from "ai";
import { z } from "zod";

export const webSearch = tool({
  description:
    "Web search via Tavily for information not in the local persona corpus (recent events, external context). Use sparingly.",
  inputSchema: z.object({
    query: z.string(),
    numResults: z.number().min(1).max(10).default(5),
  }),
  execute: async ({ query, numResults }) => {
    const key = process.env.TAVILY_API_KEY;
    if (!key) {
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
      throw new Error(`Tavily error: ${t}`);
    }
    const data = await res.json();
    return {
      query,
      results: (data.results ?? []).map(
        (r: { title: string; url: string; content: string }) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        })
      ),
    };
  },
});
