# Paul Graham AI (local)

AI persona answering questions grounded in ~220 Paul Graham essays. Fully local indexing — no NIA dependency.

Fork of [nozomio-labs/paulgraham-ai](https://github.com/nozomio-labs/paulgraham-ai) with the NIA backend ripped out and replaced by:

| Capability       | Local replacement                                         |
| ---------------- | --------------------------------------------------------- |
| Essay corpus     | Scraped from paulgraham.com → `data/essays/*.md`          |
| Semantic search  | `@xenova/transformers` MiniLM-L6-v2, cosine over JSON     |
| Browse / read    | `node:fs` over `data/essays/`                             |
| Regex search     | `ripgrep` subprocess                                      |
| Web search       | Tavily HTTP API (optional)                                |

## Setup

Requires `bun`, `node`, and `ripgrep` (`brew install ripgrep`).

```bash
bun install
cp .env.example .env   # fill in AI_GATEWAY_API_KEY, optionally TAVILY_API_KEY
```

The repo ships with `data/essays/` and `data/index/` already populated. To rebuild:

```bash
bun run scrape   # re-scrape paulgraham.com (resumable, skips existing)
bun run index    # rebuild embeddings (~2 min, MiniLM downloads once)
# or both:
bun run ingest
```

Run dev server:

```bash
bun run dev
```

## How it works

- `lib/local-tools.ts` exports the same tool surface the chat route expects (`searchEssays`, `browseEssays`, `listDirectory`, `readEssay`, `grepEssays`, `webSearch`, `getSourceContent`) backed by local files.
- `data/index/embeddings.json` holds chunk vectors (2k+ chunks across 220+ essays). Loaded once into memory on first tool call.
- MiniLM model (~25MB) is fetched from HuggingFace on first run and cached.

## Swapping the persona

Drop a different writer's essays into `data/essays/<slug>.md` (frontmatter: `title`, `slug`, `url`), then `bun run index`. Update `PAUL_GRAHAM_SYSTEM_PROMPT` in `app/api/chat/route.ts`.

## License

Original code under the LICENSE shipped with the upstream fork. Essay text remains property of Paul Graham.
