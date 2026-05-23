#!/usr/bin/env bun
/**
 * Build local embedding index over one persona corpus.
 * Default: Paul Graham's shipped data/essays/*.md -> data/index/.
 * New personas: bun run index <persona-id>
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~25MB, runs in Node via WASM/ONNX).
 */
import { buildCorpusIndex } from "../lib/indexer";
import { xenovaMiniLM } from "../lib/embedder";
import { DEFAULT_PERSONA_ID, personaPaths, safePersonaId } from "../lib/personas";

async function main() {
  const personaId = safePersonaId(process.argv[2] || DEFAULT_PERSONA_ID);
  const { documentsDir, indexDir } = personaPaths(personaId);
  console.log(`Loading embedder...`);
  const embed = xenovaMiniLM();
  console.log(`Indexing ${personaId} from ${documentsDir}`);
  const result = await buildCorpusIndex({
    documentsDir,
    indexDir,
    embed,
    onProgress: (message) => console.log(`  ${message}`),
  });
  console.log(`Wrote ${result.chunkCount} chunks across ${result.documentCount} documents.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
