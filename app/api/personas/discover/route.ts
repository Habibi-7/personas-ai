import { NextResponse } from "next/server";
import { personaWritesDisabledResponse, personaWritesEnabled } from "@/lib/deployment";

export const runtime = "nodejs";
export const maxDuration = 60;

type DiscoverRequest = {
  name?: string;
  description?: string;
  maxResults?: number;
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};

type DiscoveredSource = {
  title: string;
  url: string;
  snippet: string;
  query: string;
};

const VIDEO_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "tiktok.com",
  "twitch.tv",
  "dailymotion.com",
];

const HARD_CAP = 50;

function isVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

function buildQueries(name: string, description?: string): string[] {
  const base = name.trim();
  const ctx = description?.trim();
  const tail = ctx ? ` ${ctx}` : "";
  return [
    `${base}${tail}`,
    `${base} interview transcript`,
    `${base} essay OR blog`,
    `${base} podcast transcript`,
    `${base} wikipedia`,
  ];
}

async function tavilySearch(
  apiKey: string,
  query: string,
  maxResults: number
): Promise<TavilyResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "advanced",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily error (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { results?: TavilyResult[] };
  return data.results ?? [];
}

export async function POST(req: Request) {
  if (!personaWritesEnabled()) return personaWritesDisabledResponse();

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TAVILY_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let body: DiscoverRequest;
  try {
    body = (await req.json()) as DiscoverRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Persona name is required." }, { status: 400 });
  }

  const maxResults = Math.min(Math.max(body.maxResults ?? HARD_CAP, 1), HARD_CAP);
  const queries = buildQueries(name, body.description);
  const perQuery = Math.min(10, Math.ceil((maxResults * 1.5) / queries.length));

  const settled = await Promise.allSettled(
    queries.map((q) => tavilySearch(apiKey, q, perQuery))
  );

  const errors: string[] = [];
  const seen = new Set<string>();
  const sources: DiscoveredSource[] = [];

  settled.forEach((outcome, index) => {
    const query = queries[index];
    if (outcome.status === "rejected") {
      errors.push(`${query}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      return;
    }
    for (const result of outcome.value) {
      const url = result.url?.trim();
      if (!url) continue;
      if (isVideoUrl(url)) continue;
      const normalized = url.split("#")[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      sources.push({
        title: result.title?.trim() || url,
        url: normalized,
        snippet: result.content?.trim() ?? "",
        query,
      });
      if (sources.length >= maxResults) break;
    }
  });

  if (sources.length === 0) {
    return NextResponse.json(
      {
        sources: [],
        errors,
        error: errors.length ? "Tavily search failed." : "No sources found.",
      },
      { status: errors.length ? 502 : 404 }
    );
  }

  return NextResponse.json({ sources, errors });
}
