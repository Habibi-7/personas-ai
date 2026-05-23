import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCorpusIndex, type BuildIndexResult } from "@/lib/indexer";
import { clearPersonaCorpus } from "@/lib/persona-corpus";
import { personaPaths, slugify } from "@/lib/personas";
import { extractMarkdownFromUrl } from "@/lib/source-extractor";
import { xenovaMiniLM } from "@/lib/embedder";

export type SourceDocumentInput = {
  title?: string;
  content: string;
  url?: string;
};

export type SourceResult = {
  source: string;
  ok: boolean;
  title?: string;
  slug?: string;
  error?: string;
};

export async function ingestPersonaSources({
  personaId,
  links = [],
  documents = [],
}: {
  personaId: string;
  links?: string[];
  documents?: SourceDocumentInput[];
}): Promise<{
  results: SourceResult[];
  index: BuildIndexResult | null;
}> {
  const { documentsDir, indexDir } = personaPaths(personaId);
  const results: SourceResult[] = [];

  for (const link of normalizeLinks(links)) {
    try {
      const source = await extractMarkdownFromUrl(link);
      const slug = await uniqueSourceSlug(source.title || source.url, documentsDir);
      await writeSourceDocument({
        documentsDir,
        slug,
        title: source.title,
        url: source.url,
        markdown: source.markdown,
      });
      results.push({ source: source.url, ok: true, title: source.title, slug });
    } catch (error) {
      results.push({
        source: link,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extraction error",
      });
    }
  }

  for (const document of normalizeDocuments(documents)) {
    try {
      const title = document.title || "Untitled document";
      const slug = await uniqueSourceSlug(title, documentsDir);
      await writeSourceDocument({
        documentsDir,
        slug,
        title,
        url: document.url || `local:${slug}`,
        markdown: document.content,
      });
      results.push({ source: document.url || title, ok: true, title, slug });
    } catch (error) {
      results.push({
        source: document.title || "Untitled document",
        ok: false,
        error: error instanceof Error ? error.message : "Unknown document error",
      });
    }
  }

  const hasNewSources = results.some((result) => result.ok);
  const index = hasNewSources
    ? await buildCorpusIndex({ documentsDir, indexDir, embed: xenovaMiniLM() })
    : null;

  if (hasNewSources) clearPersonaCorpus(personaId);

  return { results, index };
}

export function hasSourceInput({
  links,
  documents,
}: {
  links?: string[];
  documents?: SourceDocumentInput[];
}) {
  return normalizeLinks(links ?? []).length > 0 || normalizeDocuments(documents ?? []).length > 0;
}

function normalizeLinks(links: string[]): string[] {
  return Array.from(new Set(links.map((link) => link.trim()).filter(Boolean)));
}

function normalizeDocuments(documents: SourceDocumentInput[]): SourceDocumentInput[] {
  return documents
    .map((document) => ({
      title: document.title?.trim(),
      content: document.content?.trim() ?? "",
      url: document.url?.trim(),
    }))
    .filter((document) => document.content.length > 0);
}

async function uniqueSourceSlug(seed: string, documentsDir: string): Promise<string> {
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
