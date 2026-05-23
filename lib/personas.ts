import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Persona = {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  voicePrompt: string;
  documentLabel: string;
  examplePrompts: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type PersonaWithStats = Persona & {
  documentCount: number;
  indexed: boolean;
};

const DATA_DIR = join(process.cwd(), "data");
export const PERSONAS_DIR = join(DATA_DIR, "personas");

export const DEFAULT_PERSONA_ID = "paul-graham";

export const DEFAULT_PERSONA: Persona = {
  id: DEFAULT_PERSONA_ID,
  name: "Paul Graham",
  description: "Grounded in 220+ Paul Graham essays.",
  avatarUrl: "/pg.png",
  documentLabel: "essays",
  examplePrompts: [
    "What is Collison installation?",
    "Why did hackers avoid building Stripe?",
    "When to bootstrap vs take funding?",
    "How to calculate default alive?",
  ],
  voicePrompt:
    "Direct and concise, like Paul Graham. Short sentences. Concrete examples. Avoid corporate speak, jargon, and hedging. Challenge conventional wisdom when the essays do. Use first-principles reasoning. Occasionally start a sentence with \"Um...\" — a PG verbal tic. Conversational, as if explaining to a smart friend.",
};

export function personaPaths(personaId: string) {
  if (personaId === DEFAULT_PERSONA_ID) {
    return {
      rootDir: DATA_DIR,
      documentsDir: join(DATA_DIR, "essays"),
      indexDir: join(DATA_DIR, "index"),
      personaFile: "",
    };
  }

  const rootDir = join(PERSONAS_DIR, safePersonaId(personaId));
  return {
    rootDir,
    documentsDir: join(rootDir, "documents"),
    indexDir: join(rootDir, "index"),
    personaFile: join(rootDir, "persona.json"),
  };
}

export async function listPersonas(): Promise<PersonaWithStats[]> {
  const personas: Persona[] = [DEFAULT_PERSONA];

  if (existsSync(PERSONAS_DIR)) {
    const entries = await readdir(PERSONAS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const personaFile = join(PERSONAS_DIR, entry.name, "persona.json");
      if (!existsSync(personaFile)) continue;
      const persona = JSON.parse(await readFile(personaFile, "utf8")) as Persona;
      if (persona.id !== DEFAULT_PERSONA_ID) personas.push(persona);
    }
  }

  return Promise.all(personas.map(withStats));
}

export async function getPersona(personaId: string | undefined): Promise<Persona> {
  const id = safePersonaId(personaId || DEFAULT_PERSONA_ID);
  if (id === DEFAULT_PERSONA_ID) return DEFAULT_PERSONA;

  const { personaFile } = personaPaths(id);
  if (!existsSync(personaFile)) {
    throw new Error(`Persona not found: ${id}`);
  }
  return JSON.parse(await readFile(personaFile, "utf8")) as Persona;
}

export async function createPersona(input: {
  name: string;
  description?: string;
  avatarUrl?: string;
  voicePrompt?: string;
}): Promise<Persona> {
  const now = new Date().toISOString();
  const id = await uniquePersonaId(slugify(input.name));
  const persona: Persona = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() || `Grounded in sources provided for ${input.name.trim()}.`,
    avatarUrl: input.avatarUrl?.trim() || undefined,
    documentLabel: "sources",
    examplePrompts: [
      `What are ${input.name.trim()}'s core ideas?`,
      `What does ${input.name.trim()} say about work?`,
      `Summarize the strongest themes in these sources.`,
      `What advice would ${input.name.trim()} give me?`,
    ],
    voicePrompt:
      input.voicePrompt?.trim() ||
      `Answer in the style and worldview of ${input.name.trim()}, grounded only in the provided sources. Be specific, cite sources by title and URL, and say when the local corpus does not cover something.`,
    createdAt: now,
    updatedAt: now,
  };

  const { rootDir, documentsDir, indexDir, personaFile } = personaPaths(id);
  await mkdir(rootDir, { recursive: true });
  await mkdir(documentsDir, { recursive: true });
  await mkdir(indexDir, { recursive: true });
  await writeFile(personaFile, `${JSON.stringify(persona, null, 2)}\n`, "utf8");
  return persona;
}

export function safePersonaId(value: string): string {
  return slugify(value);
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "persona";
}

async function uniquePersonaId(base: string): Promise<string> {
  let id = base || "persona";
  let suffix = 2;
  while (id === DEFAULT_PERSONA_ID || existsSync(personaPaths(id).personaFile)) {
    id = `${base}-${suffix}`;
    suffix++;
  }
  return id;
}

async function withStats(persona: Persona): Promise<PersonaWithStats> {
  const { documentsDir, indexDir } = personaPaths(persona.id);
  const docs = existsSync(documentsDir)
    ? (await readdir(documentsDir)).filter((file) => file.endsWith(".md"))
    : [];
  return {
    ...persona,
    documentCount: docs.length,
    indexed: existsSync(join(indexDir, "embeddings.json")) && existsSync(join(indexDir, "manifest.json")),
  };
}
