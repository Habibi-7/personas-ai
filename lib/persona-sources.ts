import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCorpusIndex, type BuildIndexResult } from "@/lib/indexer";
import { clearPersonaCorpus } from "@/lib/persona-corpus";
import { personaPaths, slugify } from "@/lib/personas";
import { normalizeRecipeUrl } from "@/lib/recipe-url";
import { extractMarkdownFromUrl } from "@/lib/source-extractor";
import { xenovaMiniLM, type Embedder } from "@/lib/embedder";

export type SourceLinkInput = {
  url: string;
  slug?: string;
  title?: string;
};

export type SourceDocumentInput = {
  title?: string;
  content: string;
  url?: string;
  slug?: string;
};

export type SourceResult = {
  source: string;
  ok: boolean;
  action?: "fetched" | "skipped" | "written";
  title?: string;
  slug?: string;
  error?: string;
};

export type IngestPersonaSourcesInput = {
  personaId: string;
  links?: Array<string | SourceLinkInput>;
  documents?: SourceDocumentInput[];
  skipExistingUrls?: boolean;
  stableSlugs?: SourceLinkInput[];
  extractUrl?: typeof extractMarkdownFromUrl;
  embed?: Embedder;
  onProgress?: (message: string) => void;
};

export async function ingestPersonaSources({
  personaId,
  links = [],
  documents = [],
  skipExistingUrls = false,
  stableSlugs = [],
  extractUrl = extractMarkdownFromUrl,
  embed = xenovaMiniLM(),
  onProgress,
}: IngestPersonaSourcesInput): Promise<{
  results: SourceResult[];
  index: BuildIndexResult | null;
}> {
  const { documentsDir, indexDir } = personaPaths(personaId);
  const results: SourceResult[] = [];
  const slugHints = buildSlugHintMap(stableSlugs);
  let urlIndex = skipExistingUrls ? await buildDocumentUrlIndex(documentsDir) : new Map();

  for (const link of normalizeLinks(links)) {
    const normalizedUrl = normalizeRecipeUrl(link.url);
    const existing = urlIndex.get(normalizedUrl);

    if (skipExistingUrls && existing) {
      results.push({
        source: link.url,
        ok: true,
        action: "skipped",
        title: existing.title,
        slug: existing.slug,
      });
      continue;
    }

    try {
      const source = await extractUrl(link.url);
      const slug = resolveSourceSlug({
        seed: link.slug || slugHints.get(normalizedUrl) || source.title || source.url,
        preferredSlug: existing?.slug || link.slug || slugHints.get(normalizedUrl),
        documentsDir,
        replaceExisting: Boolean(existing),
      });

      await writeSourceDocument({
        documentsDir,
        slug,
        title: link.title || source.title,
        url: source.url,
        markdown: source.markdown,
      });

      urlIndex.set(normalizedUrl, { slug, title: link.title || source.title, file: `${slug}.md` });
      results.push({
        source: source.url,
        ok: true,
        action: "fetched",
        title: link.title || source.title,
        slug,
      });
    } catch (error) {
      results.push({
        source: link.url,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extraction error",
      });
    }
  }

  for (const document of normalizeDocuments(documents)) {
    try {
      const title = document.title || "Untitled document";
      const slug = resolveSourceSlug({
        seed: document.slug || title,
        preferredSlug: document.slug,
        documentsDir,
        replaceExisting: false,
      });

      await writeSourceDocument({
        documentsDir,
        slug,
        title,
        url: document.url || `local:${slug}`,
        markdown: document.content,
      });

      results.push({
        source: document.url || title,
        ok: true,
        action: "written",
        title,
        slug,
      });
    } catch (error) {
      results.push({
        source: document.title || "Untitled document",
        ok: false,
        error: error instanceof Error ? error.message : "Unknown document error",
      });
    }
  }

  const shouldReindex = results.some((result) => result.ok && result.action !== "skipped");
  const index = shouldReindex
    ? await reindexPersonaCorpus(personaId, { embed, onProgress })
    : null;

  return { results, index };
}

export async function reindexPersonaCorpus(
  personaId: string,
  deps: { embed?: Embedder; onProgress?: (message: string) => void } = {}
): Promise<BuildIndexResult> {
  const { documentsDir, indexDir } = personaPaths(personaId);
  const index = await buildCorpusIndex({
    documentsDir,
    indexDir,
    embed: deps.embed ?? xenovaMiniLM(),
    onProgress: deps.onProgress,
  });
  clearPersonaCorpus(personaId);
  return index;
}

export function hasSourceInput({
  links,
  documents,
}: {
  links?: Array<string | SourceLinkInput>;
  documents?: SourceDocumentInput[];
}) {
  return normalizeLinks(links ?? []).length > 0 || normalizeDocuments(documents ?? []).length > 0;
}

function normalizeLinks(links: Array<string | SourceLinkInput>): SourceLinkInput[] {
  return links
    .map((link) => (typeof link === "string" ? { url: link.trim() } : link))
    .filter((link) => link.url.trim().length > 0);
}

function normalizeDocuments(documents: SourceDocumentInput[]): SourceDocumentInput[] {
  return documents
    .map((document) => ({
      title: document.title?.trim(),
      content: document.content?.trim() ?? "",
      url: document.url?.trim(),
      slug: document.slug?.trim(),
    }))
    .filter((document) => document.content.length > 0);
}

function buildSlugHintMap(links: SourceLinkInput[]): Map<string, string> {
  const hints = new Map<string, string>();
  for (const link of links) {
    if (!link.slug) continue;
    hints.set(normalizeRecipeUrl(link.url), link.slug);
  }
  return hints;
}

type DocumentUrlEntry = {
  slug: string;
  title: string;
  file: string;
};

async function buildDocumentUrlIndex(documentsDir: string): Promise<Map<string, DocumentUrlEntry>> {
  const index = new Map<string, DocumentUrlEntry>();
  if (!existsSync(documentsDir)) return index;

  const files = (await readdir(documentsDir)).filter((file) => file.endsWith(".md"));
  for (const file of files) {
    const raw = await readFile(join(documentsDir, file), "utf8");
    const { url, slug, title } = parseSourceFrontmatter(raw, file);
    if (!url) continue;
    index.set(normalizeRecipeUrl(url), { slug, title, file });
  }

  return index;
}

function parseSourceFrontmatter(raw: string, file: string): { url: string; slug: string; title: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split("\n")) {
      const item = line.match(/^(\w+):\s*(.*)$/);
      if (!item) continue;
      let value = item[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
      fm[item[1]] = value;
    }
  }

  const slug = fm.slug || file.replace(/\.md$/, "");
  return {
    url: fm.url || "",
    slug,
    title: fm.title || slug,
  };
}

function resolveSourceSlug({
  seed,
  preferredSlug,
  documentsDir,
  replaceExisting,
}: {
  seed: string;
  preferredSlug?: string;
  documentsDir: string;
  replaceExisting: boolean;
}): string {
  const preferred = preferredSlug ? slugify(preferredSlug).slice(0, 72) : "";
  if (preferred) {
    const preferredPath = join(documentsDir, `${preferred}.md`);
    if (!existsSync(preferredPath) || replaceExisting) return preferred;
  }

  return uniqueSourceSlugSync(seed, documentsDir);
}

function uniqueSourceSlugSync(seed: string, documentsDir: string): string {
  const base = slugify(seed).slice(0, 72) || "source";
  let slug = base;
  let suffix = 2;
  while (existsSync(join(documentsDir, `${slug}.md`))) {
    slug = `${base}-${suffix}`;
    suffix++;
  }
  return slug;
}

async function writeSourceDocument({
  documentsDir,
  slug,
  title,
  url,
  markdown,
}: {
  documentsDir: string;
  slug: string;
  title: string;
  url: string;
  markdown: string;
}) {
  const body = markdown.replace(/^# .+\n+/, "").trim();
  const content = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `slug: ${slug}`,
    `url: ${url}`,
    "---",
    "",
    `# ${title}`,
    "",
    body,
    "",
  ].join("\n");

  await writeFile(join(documentsDir, `${slug}.md`), content, "utf8");
}
