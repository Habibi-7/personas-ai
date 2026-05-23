# Persona Generator

Local-first AI personas grounded in source documents you provide. The repo ships with a Paul Graham persona backed by ~220 essays, and you can add new personas from pasted URLs.

Stack:

| Capability       | Implementation                                            |
| ---------------- | --------------------------------------------------------- |
| Source corpus    | Local markdown files under `data/essays/` or `data/personas/<id>/documents/` |
| Semantic search  | `@xenova/transformers` MiniLM-L6-v2, cosine over JSON     |
| URL extraction   | Defuddle CLI → clean markdown                             |
| Browse / read    | `node:fs` over the active persona documents               |
| Regex search     | `ripgrep` subprocess                                      |
| Web search       | Tavily HTTP API (optional)                                |
| Chat UI / models | Next.js 15 + AI SDK + Vercel AI Gateway                   |

## Setup

Requires `bun`, `node`, and `ripgrep` (`brew install ripgrep`).

```bash
bun install
cp .env.example .env   # fill in AI_GATEWAY_API_KEY, optionally TAVILY_API_KEY
```

The repo ships with Paul Graham's `data/essays/` and `data/index/` already populated. To rebuild:

```bash
bun run scrape   # re-scrape paulgraham.com (resumable, skips existing)
bun run index    # rebuild embeddings (~2 min, MiniLM downloads once)
# or both:
bun run ingest
```

To rebuild a user-created persona after editing its markdown:

```bash
bun run index naval-ravikant
```

Run dev server:

```bash
bun run dev
```

## How it works

- `lib/personas.ts` owns persona metadata and local paths.
- `app/api/personas/route.ts` creates personas from pasted URLs: Defuddle extracts markdown, files are saved locally, then embeddings are built.
- `lib/local-tools.ts` exports the tool surface the chat route consumes (`searchEssays`, `browseEssays`, `listDirectory`, `readEssay`, `grepEssays`, `webSearch`) backed by the selected persona's local files.
- `data/index/embeddings.json` holds chunk vectors (2k+ chunks across 220+ essays). Loaded once into memory on first tool call.
- MiniLM model (~25MB) is fetched from HuggingFace on first run and cached.

## Adding Personas

Click **Add Persona**, enter a name, and paste source URLs or upload/paste local documents. The app will:

1. Create `data/personas/<persona-id>/persona.json`.
2. Run Defuddle for each URL and save markdown into `documents/`.
3. Save uploaded/pasted documents into the same `documents/` folder.
4. Build `index/embeddings.json` and `index/manifest.json`.
5. Add the persona to the selector.

Generated persona data is local to your clone. You can edit/delete personas from the UI, add more URL or document sources later, or edit the markdown files directly and rerun `bun run index <persona-id>`.

## Credits

Inspired by [Nozomio Labs](https://github.com/nozomio-labs), which prototyped the original Paul Graham essay agent concept. This project re-implements the idea with a fully local stack.

## License

Code under MIT (see LICENSE). Essay text remains property of Paul Graham.
