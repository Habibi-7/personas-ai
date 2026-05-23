import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Embedder } from "./embedder";

const CHUNK_WORDS = 220;
const OVERLAP_WORDS = 40;

type Frontmatter = { title?: string; slug?: string; url?: string };

export type BuildIndexResult = {
  documentCount: number;
  chunkCount: number;
};

export async function buildCorpusIndex({
  documentsDir,
  indexDir,
  embed,
  onProgress,
}: {
  documentsDir: string;
  indexDir: string;
  embed: Embedder;
  onProgress?: (message: string) => void;
}): Promise<BuildIndexResult> {
  await mkdir(indexDir, { recursive: true });
  const files = (await readdir(documentsDir)).filter((file) => file.endsWith(".md")).sort();

  type Entry = {
    slug: string;
    title: string;
    url: string;
    chunkIdx: number;
    text: string;
    vec: number[];
  };

  const entries: Entry[] = [];
  const manifest: Array<{ slug: string; title: string; url: string; chunks: number; file: string }> = [];

  let done = 0;
  for (const file of files) {
    const raw = await readFile(join(documentsDir, file), "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const clean = stripMarkdown(body);
    const chunks = chunk(clean);
    const slug = fm.slug || file.replace(/\.md$/, "");
    const title = fm.title || file;
    const url = fm.url || "";

    for (let i = 0; i < chunks.length; i++) {
      entries.push({
        slug,
        title,
        url,
        chunkIdx: i,
        text: chunks[i],
        vec: await embed(chunks[i]),
      });
    }

    manifest.push({ slug, title, url, chunks: chunks.length, file });
    done++;
    if (done % 10 === 0 || done === files.length) {
      onProgress?.(`${done}/${files.length} documents (${entries.length} chunks)`);
    }
  }

  await writeFile(join(indexDir, "embeddings.json"), JSON.stringify(entries), "utf8");
  await writeFile(join(indexDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  return { documentCount: manifest.length, chunkCount: entries.length };
}

function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: content };

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^(\w+):\s*(.*)$/);
    if (!item) continue;
    let value = item[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    fm[item[1]] = value;
  }
  return { fm, body: match[2] };
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/[#*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, words = CHUNK_WORDS, overlap = OVERLAP_WORDS): string[] {
  const parts = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const piece = parts.slice(i, i + words).join(" ");
    if (piece.trim().length > 0) chunks.push(piece);
    if (i + words >= parts.length) break;
    i += words - overlap;
  }
  return chunks;
}
