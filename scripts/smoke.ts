#!/usr/bin/env bun
import { searchEssays, grepEssays, readEssay, browseEssays } from "../lib/local-tools";

const exec = (t: any, args: any) => t.execute(args, { toolCallId: "test", messages: [] });

console.log("--- searchEssays('how to get startup ideas') ---");
const s = await exec(searchEssays, { query: "how to get startup ideas", topK: 3 });
for (const r of s.results) console.log(`  [${r.score}] ${r.title} (${r.slug}) — ${r.text.slice(0, 100)}...`);

console.log("\n--- browseEssays (count only) ---");
const b = await exec(browseEssays, {});
console.log(`  pageCount=${b.pageCount}`);

console.log("\n--- grepEssays 'do things that don.t scale' ---");
const g = await exec(grepEssays, { pattern: "do things that don.t scale", outputMode: "files_with_matches" });
console.log(g.output.split("\n").filter(Boolean).slice(0, 5).join("\n"));

console.log("\n--- readEssay('ds') ---");
const r = await exec(readEssay, { path: "ds" });
console.log(`  title=${r.title}  url=${r.url}  ${r.content.length} chars`);
