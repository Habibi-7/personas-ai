import { NextResponse } from "next/server";
import { personaWritesDisabledResponse, personaWritesEnabled } from "@/lib/deployment";
import { hasSourceInput, ingestPersonaSources, type SourceDocumentInput } from "@/lib/persona-sources";
import { syncPersonaRecipe } from "@/lib/persona-recipe";
import { createPersona, listPersonas } from "@/lib/personas";

export const runtime = "nodejs";
export const maxDuration = 300;

type CreatePersonaRequest = {
  name?: string;
  description?: string;
  avatarUrl?: string;
  voicePrompt?: string;
  links?: string[];
  documents?: SourceDocumentInput[];
};

export async function GET() {
  return NextResponse.json({ personas: await listPersonas() });
}

export async function POST(req: Request) {
  if (!personaWritesEnabled()) return personaWritesDisabledResponse();

  try {
    const input = (await req.json()) as CreatePersonaRequest;
    const name = input.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Persona name is required." }, { status: 400 });
    }
    if (!hasSourceInput({ links: input.links, documents: input.documents })) {
      return NextResponse.json({ error: "Add at least one source URL or document." }, { status: 400 });
    }

    const persona = await createPersona({
      name,
      description: input.description,
      avatarUrl: input.avatarUrl,
      voicePrompt: input.voicePrompt,
    });
    const { results, index } = await ingestPersonaSources({
      personaId: persona.id,
      links: input.links,
      documents: input.documents,
    });

    const successCount = results.filter((result) => result.ok).length;
    if (successCount === 0) {
      return NextResponse.json(
        { error: "No sources could be added.", persona, results },
        { status: 422 }
      );
    }

    const recipe = await syncPersonaRecipe(persona.id, {
      links: input.links,
      documents: input.documents,
      results,
    });

    return NextResponse.json({
      persona,
      results,
      index,
      recipe,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create persona." },
      { status: 500 }
    );
  }
}
