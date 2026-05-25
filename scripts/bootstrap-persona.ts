#!/usr/bin/env bun
/**
 * Bootstrap a persona from its recipe (persona.json + sources.json).
 *
 * Usage:
 *   bun run bootstrap-persona naval-ravikant
 *   bun run bootstrap-persona naval-ravikant --force
 *   bun run bootstrap-persona naval-ravikant --index-only
 *   bun run bootstrap-persona --all
 */
import {
  installPersonaRecipe,
  listRecipePersonaIds,
  type RecipeInstallResult,
} from "@/lib/persona-recipe";
import { safePersonaId } from "@/lib/personas";

type CliOptions = {
  all: boolean;
  forceRefetch: boolean;
  indexOnly: boolean;
  personaIds: string[];
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const personaIds = options.all ? await listRecipePersonaIds() : options.personaIds;

  if (personaIds.length === 0) {
    console.error("No persona recipes found. Pass a persona id or use --all.");
    process.exit(1);
  }

  const results: RecipeInstallResult[] = [];
  for (const personaId of personaIds) {
    console.log(`\nBootstrapping ${personaId}...`);
    const result = await installPersonaRecipe(personaId, {
      forceRefetch: options.forceRefetch,
      indexOnly: options.indexOnly,
    });
    results.push(result);
    printResult(result);
  }

  const failed = results.reduce((count, result) => count + result.failed, 0);
  if (failed > 0) process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    all: false,
    forceRefetch: false,
    indexOnly: false,
    personaIds: [],
  };

  for (const arg of argv) {
    if (arg === "--all") options.all = true;
    else if (arg === "--force") options.forceRefetch = true;
    else if (arg === "--index-only") options.indexOnly = true;
    else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      options.personaIds.push(safePersonaId(arg));
    }
  }

  if (!options.all && options.personaIds.length === 0) {
    throw new Error("Provide a persona id or pass --all.");
  }

  return options;
}

function printResult(result: RecipeInstallResult) {
  const indexSummary = result.index
    ? `${result.index.documentCount} documents, ${result.index.chunkCount} chunks`
    : "skipped";

  console.log(
    `  fetched=${result.fetched} skipped=${result.skipped} failed=${result.failed} index=${indexSummary}`
  );

  for (const error of result.errors) {
    console.error(`  ! ${error.source}: ${error.error}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
