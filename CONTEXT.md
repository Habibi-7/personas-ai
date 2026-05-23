# Domain Language

Canonical vocabulary for this codebase. Use these terms exactly in code, docs,
and conversations — drift dilutes meaning.

## Persona

A local assistant profile backed by a corpus of markdown source documents.
Metadata lives in `persona.json`; generated personas live under
`data/personas/<persona-id>/`.

Paul Graham is the bundled default persona and still uses the legacy
`data/essays/` and `data/index/` paths to avoid moving the shipped corpus.

## Source Document

A single markdown document used as persona evidence. Stored with YAML
frontmatter (`title`, `slug`, `url`). For generated personas the path is
`data/personas/<persona-id>/documents/<slug>.md`.

## Essay

A Source Document from Paul Graham's bundled corpus.

## Chunk

A ~220-word slice of a Source Document's body, with 40-word overlap to
neighbours. The unit of semantic retrieval. Identified by `(slug, chunkIdx)`.

## Embedder

A function `(text) => Promise<number[]>` producing an L2-normalized vector for
a piece of text. Today: Xenova MiniLM-L6-v2 (384 dim) running in-process via
ONNX. The `Embedder` interface is the seam — callers don't know which model.

## Index

Two on-disk artefacts under a persona's `index/` directory:

- `embeddings.json` — array of `{slug, title, url, chunkIdx, text, vec}`. Used
  for semantic search. ~15–20K entries.
- `manifest.json` — array of `{slug, title, url, chunks, file}`. Used for
  browse/list operations without paying the embeddings load cost.

Paul Graham's default index lives in `data/index/`. Generated persona indexes
live in `data/personas/<persona-id>/index/`. Rebuild with `bun run index` or
`bun run index <persona-id>` (`scripts/build-index.ts`).

## Manifest

Specifically the per-essay metadata file above (`data/index/manifest.json`).
Lighter than the full embeddings index; loaded for browse/list/read paths.

## Corpus

The single module owning all queries against a persona corpus: semantic search,
metadata browse, slug-prefix list, full-text grep, and individual source read.
Lives in `lib/corpus.ts`. Built by `createCorpus({ embedder, essaysDir,
indexDir })`; `essaysDir` may point at generic source documents. Lazy init —
first call triggers index load and embedder warmup.

The Corpus is the **test surface**. Tool definitions in `lib/local-tools.ts`
are thin Zod adapters over Corpus methods.

## Web search

Not part of the Corpus. External Tavily HTTP API. Lives in `lib/web-search.ts`
as its own adapter.

## Source extraction

Not part of the Corpus. Defuddle CLI turns user-provided URLs into clean
markdown. Lives behind `lib/source-extractor.ts` so other extractors can be
added later without changing persona/index code.
