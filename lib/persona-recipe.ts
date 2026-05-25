/**
 * PersonaRecipe — declarative bootstrap bundle for a persona.
 *
 * A recipe is the portable, version-controlled definition of a persona's
 * evidence. It pairs `persona.json` (identity) with `sources.json` (where
 * to fetch evidence). Documents and indexes are build artefacts produced by
 * `installPersonaRecipe()`.
 *
 * See CONTEXT.md → PersonaRecipe, RecipeInstall.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuildIndexResult } from "@/lib/indexer";
import {
  ingestPersonaSources,
  reindexPersonaCorpus,
  type SourceDocumentInput,
} from "@/lib/persona-sources";
import { DEFAULT_PERSONA_ID, getPersona, personaPaths, personasRootDir } from "@/lib/personas";
import { normalizeRecipeUrl } from "@/lib/recipe-url";
import type { Embedder } from "@/lib/embedder";
import { extractMarkdownFromUrl } from "@/lib/source-extractor";

export const PERSONA_RECIPE_SCHEMA = 1 as const;

export type RecipeLink = {
  url: string;
  slug?: string;
  title?: string;
};

export type PersonaRecipe = {
  schema: typeof PERSONA_RECIPE_SCHEMA;
  links: RecipeLink[];
  documents?: SourceDocumentInput[];
};

export type RecipeInstallOptions = {
  /** Re-fetch URLs even when a matching document already exists. */
  forceRefetch?: boolean;
  /** Skip fetching; rebuild the index from existing documents only. */
  indexOnly?: boolean;
};

export type RecipeInstallResult = {
  personaId: string;
  fetched: number;
  skipped: number;
  failed: number;
  indexed: boolean;
  index: BuildIndexResult | null;
  errors: Array<{ source: string; error: string }>;
};

export type RecipeStatus = "ready" | "needs-bootstrap" | "missing";

export class PersonaRecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonaRecipeError";
  }
}

export function recipePaths(personaId: string) {
  const { rootDir, sourcesFile, personaFile } = personaPaths(personaId);
  return { rootDir, sourcesFile, personaFile };
}

export function parsePersonaRecipe(raw: unknown): PersonaRecipe {
  if (!raw || typeof raw !== "object") {
    throw new PersonaRecipeError("Recipe must be a JSON object.");
  }

  const value = raw as Record<string, unknown>;
  if (value.schema !== PERSONA_RECIPE_SCHEMA) {
    throw new PersonaRecipeError(
      `Unsupported recipe schema ${String(value.schema)}; expected ${PERSONA_RECIPE_SCHEMA}.`
    );
  }

  const links = normalizeRecipeLinks(value.links);
  const documents = normalizeRecipeDocuments(value.documents);

  if (links.length === 0 && documents.length === 0) {
    throw new PersonaRecipeError("Recipe must include at least one link or document.");
  }

  return { schema: PERSONA_RECIPE_SCHEMA, links, documents };
}

export async function readPersonaRecipe(personaId: string): Promise<PersonaRecipe> {
  const { sourcesFile } = recipePaths(personaId);
  if (!existsSync(sourcesFile)) {
    throw new PersonaRecipeError(`Recipe not found: ${sourcesFile}`);
  }

  const raw = JSON.parse(await readFile(sourcesFile, "utf8")) as unknown;
  return parsePersonaRecipe(raw);
}

export async function writePersonaRecipe(personaId: string, recipe: PersonaRecipe): Promise<void> {
  const parsed = parsePersonaRecipe(recipe);
  const { rootDir, sourcesFile } = recipePaths(personaId);
  await mkdir(rootDir, { recursive: true });
  await writeFile(sourcesFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export function recipeFromManifestEntries(
  entries: Array<{ url: string; slug?: string; title?: string }>
): PersonaRecipe {
  const links = entries
    .map((entry) => ({
      url: entry.url.trim(),
      slug: entry.slug?.trim() || undefined,
      title: entry.title?.trim() || undefined,
    }))
    .filter((entry) => entry.url.length > 0);

  return { schema: PERSONA_RECIPE_SCHEMA, links };
}

export async function listRecipePersonaIds(): Promise<string[]> {
  if (!existsSync(personasRootDir())) return [];

  const entries = await readdir(personasRootDir(), { withFileTypes: true });
  const ids: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const { sourcesFile, personaFile } = personaPaths(entry.name);
    if (existsSync(sourcesFile) && existsSync(personaFile)) {
      ids.push(entry.name);
    }
  }

  return ids.sort();
}

export async function getRecipeStatus(personaId: string): Promise<RecipeStatus> {
  if (personaId === DEFAULT_PERSONA_ID) return "ready";

  const { sourcesFile, personaFile, indexDir } = personaPaths(personaId);
  if (!existsSync(sourcesFile) || !existsSync(personaFile)) return "missing";

  const indexed =
    existsSync(join(indexDir, "embeddings.json")) && existsSync(join(indexDir, "manifest.json"));
  return indexed ? "ready" : "needs-bootstrap";
}

export type RecipeInstallDeps = {
  extractUrl?: typeof extractMarkdownFromUrl;
  embed?: Embedder;
  onProgress?: (message: string) => void;
};

export async function installPersonaRecipe(
  personaId: string,
  options: RecipeInstallOptions = {},
  deps: RecipeInstallDeps = {}
): Promise<RecipeInstallResult> {
  if (personaId === DEFAULT_PERSONA_ID) {
    throw new PersonaRecipeError("The bundled Paul Graham persona does not use a recipe.");
  }

  await getPersona(personaId);
  const recipe = await readPersonaRecipe(personaId);
  const { documentsDir, indexDir } = personaPaths(personaId);
  await mkdir(documentsDir, { recursive: true });
  await mkdir(indexDir, { recursive: true });

  if (options.indexOnly) {
    const index = await reindexPersonaCorpus(personaId, {
      embed: deps.embed,
      onProgress: deps.onProgress,
    });
    return {
      personaId,
      fetched: 0,
      skipped: 0,
      failed: 0,
      indexed: true,
      index,
      errors: [],
    };
  }

  const { results, index } = await ingestPersonaSources({
    personaId,
    links: recipe.links,
    documents: recipe.documents,
    skipExistingUrls: !options.forceRefetch,
    stableSlugs: recipe.links,
    extractUrl: deps.extractUrl,
    embed: deps.embed,
    onProgress: deps.onProgress,
  });

  const fetched = results.filter((result) => result.ok && result.action === "fetched").length;
  const skipped = results.filter((result) => result.ok && result.action === "skipped").length;
  const failed = results.filter((result) => !result.ok).length;
  const errors = results
    .filter((result) => !result.ok)
    .map((result) => ({ source: result.source, error: result.error ?? "Unknown error" }));

  return {
    personaId,
    fetched,
    skipped,
    failed,
    indexed: index !== null,
    index,
    errors,
  };
}

function normalizeRecipeLinks(raw: unknown): RecipeLink[] {
  if (!Array.isArray(raw)) {
    throw new PersonaRecipeError("Recipe links must be an array.");
  }

  const links: RecipeLink[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const url = item.trim();
      if (url) links.push({ url });
      continue;
    }

    if (!item || typeof item !== "object") {
      throw new PersonaRecipeError("Each recipe link must be a URL string or object.");
    }

    const link = item as Record<string, unknown>;
    const url = typeof link.url === "string" ? link.url.trim() : "";
    if (!url) {
      throw new PersonaRecipeError("Recipe link objects must include a non-empty url.");
    }

    links.push({
      url,
      slug: typeof link.slug === "string" ? link.slug.trim() || undefined : undefined,
      title: typeof link.title === "string" ? link.title.trim() || undefined : undefined,
    });
  }

  return dedupeLinks(links);
}

function normalizeRecipeDocuments(raw: unknown): SourceDocumentInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new PersonaRecipeError("Recipe documents must be an array.");
  }

  const documents: SourceDocumentInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const document = item as Record<string, unknown>;
    const content = typeof document.content === "string" ? document.content.trim() : "";
    if (!content) continue;
    documents.push({
      title: typeof document.title === "string" ? document.title.trim() || undefined : undefined,
      content,
      url: typeof document.url === "string" ? document.url.trim() || undefined : undefined,
      slug: typeof document.slug === "string" ? document.slug.trim() || undefined : undefined,
    });
  }
  return documents;
}

function dedupeLinks(links: RecipeLink[]): RecipeLink[] {
  const seen = new Set<string>();
  const out: RecipeLink[] = [];
  for (const link of links) {
    const key = normalizeRecipeUrl(link.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

export { normalizeRecipeUrl } from "@/lib/recipe-url";
