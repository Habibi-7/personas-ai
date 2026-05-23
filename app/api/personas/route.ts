import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { buildCorpusIndex } from "@/lib/indexer";
import { clearPersonaCorpus } from "@/lib/persona-corpus";
import { createPersona, listPersonas, personaPaths, slugify } from "@/lib/personas";
import { extractMarkdownFromUrl } from "@/lib/source-extractor";
import { xenovaMiniLM } from "@/lib/embedder";

export const runtime = "nodejs";
export const maxDuration = 300;

type CreatePersonaRequest = {
  name?: string;
  description?: string;
  avatarUrl?: string;
  voicePrompt?: string;
  links?: string[];
};

type ExtractionResult = {
  url: string;
  ok: boolean;
  title?: string;
  slug?: string;
  error?: string;
};

export async function GET() {
  return NextResponse.json({ personas: await listPersonas() });
}

export async function POST(req: Request) {
  try {
    const input = (await req.json()) as CreatePersonaRequest;
    const name = input.name?.trim();
    const links = normalizeLinks(input.links ?? []);

    if (!name) {
      return NextResponse.json({ error: "Persona name is required." }, { status: 400 });
    }
    if (links.length === 0) {
      return NextResponse.json({ error: "Add at least one source URL." }, { status: 400 });
    }

    const persona = await createPersona({
      name,
      description: input.description,
      avatarUrl: input.avatarUrl,
      voicePrompt: input.voicePrompt,
    });
    const { documentsDir, indexDir } = personaPaths(persona.id);
    const extractionResults: ExtractionResult[] = [];

    for (const link of links) {
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
        extractionResults.push({ url: source.url, ok: true, title: source.title, slug });
      } catch (error) {
        extractionResults.push({
          url: link,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown extraction error",
        });
      }
    }

    const successCount = extractionResults.filter((result) => result.ok).length;
    if (successCount === 0) {
      return NextResponse.json(
        { error: "No links could be extracted.", persona, extractionResults },
        { status: 422 }
      );
    }

    const index = await buildCorpusIndex({
      documentsDir,
      indexDir,
      embed: xenovaMiniLM(),
    });
    clearPersonaCorpus(persona.id);

    return NextResponse.json({
      persona,
      extractionResults,
      index,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create persona." },
      { status: 500 }
    );
  }
}

function normalizeLinks(links: string[]): string[] {
  return Array.from(new Set(links.map((link) => link.trim()).filter(Boolean)));
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
