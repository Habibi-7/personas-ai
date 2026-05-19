# Domain Language

Canonical vocabulary for this codebase. Use these terms exactly in code, docs,
and conversations — drift dilutes meaning.

## Essay

A single Paul Graham essay scraped from paulgraham.com. Stored as a markdown
file in `data/essays/<slug>.md` with YAML frontmatter (`title`, `slug`, `url`).
The slug is the canonical identifier (matches the source URL path).

## Chunk

A ~220-word slice of an Essay's body, with 40-word overlap to neighbours. The
unit of semantic retrieval. Identified by `(slug, chunkIdx)`.

## Embedder

A function `(text) => Promise<number[]>` producing an L2-normalized vector for
a piece of text. Today: Xenova MiniLM-L6-v2 (384 dim) running in-process via
ONNX. The `Embedder` interface is the seam — callers don't know which model.

## Index

Two on-disk artefacts under `data/index/`:

- `embeddings.json` — array of `{slug, title, url, chunkIdx, text, vec}`. Used
  for semantic search. ~15–20K entries.
- `manifest.json` — array of `{slug, title, url, chunks, file}`. Used for
  browse/list operations without paying the embeddings load cost.

Both rebuilt by `bun run index` (`scripts/build-index.ts`).

## Manifest

Specifically the per-essay metadata file above (`data/index/manifest.json`).
Lighter than the full embeddings index; loaded for browse/list/read paths.

## Corpus

The single module owning all queries against the Essay corpus: semantic search,
metadata browse, slug-prefix list, full-text grep, and individual essay read.
Lives in `lib/corpus.ts`. Built by `createCorpus({ embedder, essaysDir,
indexDir })`. Lazy init — first call triggers index load and embedder warmup.

The Corpus is the **test surface**. Tool definitions in `lib/local-tools.ts`
are thin Zod adapters over Corpus methods.

## Web search

Not part of the Corpus. External Tavily HTTP API. Lives in `lib/web-search.ts`
as its own adapter.
