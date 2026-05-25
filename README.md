# Persona Generator

Local-first AI personas grounded in source documents you provide. The repo ships with a Paul Graham persona backed by ~220 essays, and you can add new personas from pasted URLs.

Stack:


| Capability       | Implementation                                                               |
| ---------------- | ---------------------------------------------------------------------------- |
| Source corpus    | Local markdown files under `data/essays/` or `data/personas/<id>/documents/` |
| Semantic search  | `@xenova/transformers` MiniLM-L6-v2, cosine over JSON                        |
| URL extraction   | Defuddle CLI → clean markdown                                                |
| Browse / read    | `node:fs` over the active persona documents                                  |
| Regex search     | `ripgrep` subprocess                                                         |
| Web search       | Tavily HTTP API (optional)                                                   |
| Chat UI / models | Next.js 15 + AI SDK + Vercel AI Gateway                                      |


## Local Setup

You need `bun`, `node`, and `ripgrep`.

```bash
bun install
cp .env.example .env
bun run dev
```

Add your own keys to `.env`:

- `AI_GATEWAY_API_KEY` is required for chat.
- `TAVILY_API_KEY` is optional. Enables the in-chat web search tool and the
  **Discover** button for auto-generating persona sources.

## Default Persona

Paul Graham is included by default so the app works immediately after setup.
His essays are already scraped and indexed.

## Adding Your Own Personas

Click **Add Persona**, enter a name, and add sources. Sources can be URLs,
uploaded files, or pasted text.

### Auto-discover sources (Tavily)

Click **Discover** in the Add Persona panel to pull up to 50 candidate URLs via
Tavily. Review the list, uncheck anything unwanted, add to source links, then
build as normal. Video hosts are filtered. Requires `TAVILY_API_KEY`.

### Build pipeline

When you add a persona, the app turns sources into clean markdown, breaks them
into searchable chunks, builds local embeddings, and then lets the chat answer
from those sources.

Everything you create stays in your local clone. You can edit or delete personas
from the UI.

## Credits

Inspired by [Nozomio Labs](https://github.com/nozomio-labs), which prototyped the original Paul Graham essay agent concept. This project re-implements the idea with a fully local stack.

## License

MIT