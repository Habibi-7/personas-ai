#!/usr/bin/env bun
/**
 * Build local embedding index over data/essays/*.md.
 * Output: data/index/embeddings.json  (chunks with vectors)
 *         data/index/manifest.json    (file list + metadata)
 *
 * Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~25MB, runs in Node via WASM/ONNX).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false;
env.useBrowserCache = false;

const ESSAYS_DIR = join(process.cwd(), "data", "essays");
const INDEX_DIR = join(process.cwd(), "data", "index");
const MODEL = "Xenova/all-MiniLM-L6-v2";
const CHUNK_WORDS = 220;
const OVERLAP_WORDS = 40;

type Frontmatter = { title: string; slug: string; url: string };

function parseFrontmatter(content: string): { fm: Frontmatter; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: { title: "", slug: "", url: "" }, body: content };
  const lines = m[1].split("\n");
  const fm: Record<string, string> = {};
  for (const line of lines) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = JSON.parse(v);
    fm[mm[1]] = v;
  }
  return { fm: fm as unknown as Frontmatter, body: m[2] };
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep text
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // inline/code
    .replace(/[#*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chunk(text: string, words = CHUNK_WORDS, overlap = OVERLAP_WORDS): string[] {
  const arr = text.split(/\s+/);
  const out: string[] = [];
  let i = 0;
  while (i < arr.length) {
    const piece = arr.slice(i, i + words).join(" ");
    if (piece.trim().length > 0) out.push(piece);
    if (i + words >= arr.length) break;
    i += words - overlap;
  }
  return out;
}

async function main() {
  await mkdir(INDEX_DIR, { recursive: true });
  console.log(`Loading model ${MODEL}...`);
  const embedder = await pipeline("feature-extraction", MODEL);

  const files = (await readdir(ESSAYS_DIR)).filter((f) => f.endsWith(".md")).sort();
  console.log(`Indexing ${files.length} essays...`);

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
    const raw = await readFile(join(ESSAYS_DIR, file), "utf8");
    const { fm, body } = parseFrontmatter(raw);
    const clean = stripMarkdown(body);
    const chunks = chunk(clean);
    for (let i = 0; i < chunks.length; i++) {
      const out = await embedder(chunks[i], { pooling: "mean", normalize: true });
      const vec = Array.from(out.data as Float32Array);
      entries.push({
        slug: fm.slug || file.replace(/\.md$/, ""),
        title: fm.title || file,
        url: fm.url || "",
        chunkIdx: i,
        text: chunks[i],
        vec,
      });
    }
    manifest.push({
      slug: fm.slug || file.replace(/\.md$/, ""),
      title: fm.title || file,
      url: fm.url || "",
      chunks: chunks.length,
      file,
    });
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${files.length} essays (${entries.length} chunks)`);
  }

  await writeFile(join(INDEX_DIR, "embeddings.json"), JSON.stringify(entries));
  await writeFile(join(INDEX_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${entries.length} chunks across ${manifest.length} essays.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
