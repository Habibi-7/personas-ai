import { NextResponse } from "next/server";
import { hasSourceInput, ingestPersonaSources, type SourceDocumentInput } from "@/lib/persona-sources";
import { DEFAULT_PERSONA_ID, deletePersona, getPersona, updatePersona } from "@/lib/personas";
import { clearPersonaCorpus } from "@/lib/persona-corpus";

export const runtime = "nodejs";
export const maxDuration = 300;

type PersonaRouteContext = {
  params: Promise<{ personaId: string }>;
};

type UpdatePersonaRequest = {
  name?: string;
  description?: string;
  avatarUrl?: string;
  voicePrompt?: string;
  links?: string[];
  documents?: SourceDocumentInput[];
};

export async function GET(_req: Request, context: PersonaRouteContext) {
  const { personaId } = await context.params;
  return NextResponse.json({ persona: await getPersona(personaId) });
}

export async function PATCH(req: Request, context: PersonaRouteContext) {
  try {
    const { personaId } = await context.params;
    if (personaId === DEFAULT_PERSONA_ID) {
      return NextResponse.json({ error: "The bundled Paul Graham persona cannot be edited." }, { status: 400 });
    }

    const input = (await req.json()) as UpdatePersonaRequest;
    const persona = await updatePersona(personaId, {
      name: input.name,
      description: input.description,
      avatarUrl: input.avatarUrl,
      voicePrompt: input.voicePrompt,
    });

    const sourceResult = hasSourceInput({ links: input.links, documents: input.documents })
      ? await ingestPersonaSources({
          personaId: persona.id,
          links: input.links,
          documents: input.documents,
        })
      : { results: [], index: null };

    clearPersonaCorpus(persona.id);
    return NextResponse.json({ persona, ...sourceResult });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update persona." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, context: PersonaRouteContext) {
  try {
    const { personaId } = await context.params;
    if (personaId === DEFAULT_PERSONA_ID) {
      return NextResponse.json({ error: "The bundled Paul Graham persona cannot be deleted." }, { status: 400 });
    }

    await deletePersona(personaId);
    clearPersonaCorpus(personaId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete persona." },
      { status: 500 }
    );
  }
}
