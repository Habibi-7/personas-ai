import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

export type ExtractedSource = {
  title: string;
  url: string;
  markdown: string;
};

type DefuddleResult = {
  title?: string;
  content?: string;
};

export async function extractMarkdownFromUrl(url: string): Promise<ExtractedSource> {
  const normalizedUrl = normalizeUrl(url);
  const output = await runDefuddle(normalizedUrl);
  const parsed = JSON.parse(output) as DefuddleResult;
  const markdown = (parsed.content ?? "").trim();

  if (!markdown) {
    throw new Error(`Defuddle returned no markdown for ${normalizedUrl}`);
  }

  return {
    title: parsed.title?.trim() || titleFromUrl(normalizedUrl),
    url: normalizedUrl,
    markdown,
  };
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

async function runDefuddle(url: string): Promise<string> {
  const localBin = join(process.cwd(), "node_modules", ".bin", "defuddle");
  const command = await canAccess(localBin) ? localBin : "bunx";
  const args = command === localBin
    ? ["parse", url, "--json", "--md"]
    : ["defuddle", "parse", url, "--json", "--md"];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Defuddle failed for ${url}: ${stderr || `exit ${code}`}`));
    });
  });
}

async function canAccess(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  const finalPath = parsed.pathname.split("/").filter(Boolean).at(-1) || parsed.hostname;
  return decodeURIComponent(finalPath).replace(/[-_]+/g, " ");
}
