#!/usr/bin/env bun
/**
 * Scrape Paul Graham essays from paulgraham.com -> data/essays/*.md
 * Resumable: skips files that already exist.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import TurndownService from "turndown";

const BASE = "https://www.paulgraham.com";
const INDEX_URL = `${BASE}/articles.html`;
const OUT_DIR = join(process.cwd(), "data", "essays");

const NAV_PAGES = new Set([
  "index.html", "articles.html", "books.html", "arc.html", "bel.html",
  "lisp.html", "antispam.html", "kedrosky.html", "faq.html", "raq.html",
  "quo.html", "rss.html", "bio.html", "noop.html", "rfs.html",
]);

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; LocalEssayIndexer/1.0)" },
  });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return await res.text();
}

function extractEssayLinks(html: string): string[] {
  const matches = html.matchAll(/href="([a-z][a-z0-9_-]*\.html)"/g);
  const links = new Set<string>();
  for (const m of matches) {
    const file = m[1];
    if (!NAV_PAGES.has(file)) links.add(file);
  }
  return [...links].sort();
}

function extractTitleAndBody(html: string, slug: string): { title: string; body: string } | null {
  // PG essays: title in <font size=3> or <title>; body is in main content table.
  let title = "";
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) title = titleMatch[1].trim();

  // Strip head, scripts, styles
  let body = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Heuristic: PG essay body is the largest <font size=2> ... </font> block,
  // typically the last big text-bearing block. Try grabbing all font-size-2 blocks
  // and pick the longest with substantial text.
  const fontBlocks = [...body.matchAll(/<font[^>]*size=["']?2["']?[^>]*>([\s\S]*?)<\/font>/gi)];
  let essayHtml = "";
  if (fontBlocks.length > 0) {
    essayHtml = fontBlocks
      .map((b) => b[1])
      .filter((b) => b.replace(/<[^>]+>/g, "").trim().length > 200)
      .sort((a, b) => b.length - a.length)[0] || "";
  }

  if (!essayHtml || essayHtml.length < 500) {
    // Fallback: try whole body, stripped
    essayHtml = body;
  }

  // Final text-length sanity check
  const plain = essayHtml.replace(/<[^>]+>/g, "").trim();
  if (plain.length < 400) return null;

  const md = turndown.turndown(essayHtml).trim();
  return { title: title || slug, body: md };
}

function buildFrontmatter(slug: string, title: string): string {
  const url = `${BASE}/${slug}`;
  return `---\ntitle: ${JSON.stringify(title)}\nslug: ${slug.replace(/\.html$/, "")}\nurl: ${url}\n---\n\n# ${title}\n\n`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Fetching index: ${INDEX_URL}`);
  const indexHtml = await fetchText(INDEX_URL);
  const links = extractEssayLinks(indexHtml);
  console.log(`Found ${links.length} candidate essay links`);

  const existing = new Set(await readdir(OUT_DIR).catch(() => []));
  let saved = 0, skipped = 0, failed = 0;

  for (const link of links) {
    const slug = link.replace(/\.html$/, "");
    const outFile = `${slug}.md`;
    if (existing.has(outFile)) { skipped++; continue; }

    const url = `${BASE}/${link}`;
    try {
      const html = await fetchText(url);
      const parsed = extractTitleAndBody(html, link);
      if (!parsed) {
        console.log(`  skip (too short): ${link}`);
        continue;
      }
      const fm = buildFrontmatter(link, parsed.title);
      await writeFile(join(OUT_DIR, outFile), fm + parsed.body + "\n", "utf8");
      saved++;
      if (saved % 10 === 0) console.log(`  saved ${saved} (last: ${link})`);
      // Polite delay
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      failed++;
      console.error(`  fail ${link}: ${(e as Error).message}`);
    }
  }
  console.log(`Done. saved=${saved} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
