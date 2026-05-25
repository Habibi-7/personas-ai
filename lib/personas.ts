import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  hasRecipe: boolean;
  recipeStatus: "ready" | "needs-bootstrap" | "missing" | "n/a";
};

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

export function dataRootDir() {
  return join(process.cwd(), "data");
}

export function personasRootDir() {
  return join(dataRootDir(), "personas");
}

export function personaPaths(personaId: string) {
  const dataDir = dataRootDir();
  if (personaId === DEFAULT_PERSONA_ID) {
    return {
      rootDir: dataDir,
      documentsDir: join(dataDir, "essays"),
      indexDir: join(dataDir, "index"),
      personaFile: "",
      sourcesFile: "",
    };
  }

  const rootDir = join(personasRootDir(), safePersonaId(personaId));
  return {
    rootDir,
    documentsDir: join(rootDir, "documents"),
    indexDir: join(rootDir, "index"),
    personaFile: join(rootDir, "persona.json"),
    sourcesFile: join(rootDir, "sources.json"),
  };
}

export async function listPersonas(): Promise<PersonaWithStats[]> {
  const personas: Persona[] = [DEFAULT_PERSONA];
  const personasDir = personasRootDir();

  if (existsSync(personasDir)) {
    const entries = await readdir(personasDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const personaFile = join(personasDir, entry.name, "persona.json");
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

export async function updatePersona(
  personaId: string,
  input: Partial<Pick<Persona, "name" | "description" | "avatarUrl" | "voicePrompt">>
): Promise<Persona> {
  const id = safePersonaId(personaId);
  if (id === DEFAULT_PERSONA_ID) {
    throw new Error("The bundled Paul Graham persona cannot be edited.");
  }

  const current = await getPersona(id);
  const next: Persona = {
    ...current,
    name: input.name?.trim() || current.name,
    description: input.description?.trim() || current.description,
    avatarUrl: input.avatarUrl?.trim() || undefined,
    voicePrompt: input.voicePrompt?.trim() || current.voicePrompt,
    updatedAt: new Date().toISOString(),
  };

  const { personaFile } = personaPaths(id);
  await writeFile(personaFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function deletePersona(personaId: string): Promise<void> {
  const id = safePersonaId(personaId);
  if (id === DEFAULT_PERSONA_ID) {
    throw new Error("The bundled Paul Graham persona cannot be deleted.");
  }

  const { rootDir } = personaPaths(id);
  if (!existsSync(rootDir)) {
    throw new Error(`Persona not found: ${id}`);
  }
  await rm(rootDir, { recursive: true, force: true });
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
  const { documentsDir, indexDir, sourcesFile } = personaPaths(persona.id);
  const docs = existsSync(documentsDir)
    ? (await readdir(documentsDir)).filter((file) => file.endsWith(".md"))
    : [];
  const indexed =
    existsSync(join(indexDir, "embeddings.json")) && existsSync(join(indexDir, "manifest.json"));
  const hasRecipe = Boolean(sourcesFile) && existsSync(sourcesFile);

  let recipeStatus: PersonaWithStats["recipeStatus"] = "n/a";
  if (persona.id !== DEFAULT_PERSONA_ID) {
    if (!hasRecipe) recipeStatus = "missing";
    else if (indexed) recipeStatus = "ready";
    else recipeStatus = "needs-bootstrap";
  }

  return {
    ...persona,
    documentCount: docs.length,
    indexed,
    hasRecipe,
    recipeStatus,
  };
}
