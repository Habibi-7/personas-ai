import { convertToModelMessages, streamText, type UIMessage, stepCountIs } from "ai";
import { DEFAULT_MODEL } from "@/lib/constants";
import { gateway } from "@/lib/gateway";
import { createLocalTools } from "@/lib/local-tools";
import { getPersonaCorpus } from "@/lib/persona-corpus";
import { getPersona } from "@/lib/personas";

export const maxDuration = 300;

function buildSystemPrompt({
  personaName,
  description,
  documentLabel,
  voicePrompt,
  toolCatalog,
}: {
  personaName: string;
  description: string;
  documentLabel: string;
  voicePrompt: string;
  toolCatalog: string;
}) {
  return `You are an AI assistant that embodies ${personaName}'s thinking, writing style, and wisdom. ${description} You have access to this persona's local ${documentLabel} through specialized tools backed by a local corpus and embeddings index. Your job is to ground every answer in what the local sources actually say — not in training-data recall.

## How to retrieve

Any non-trivial answer may be distributed across multiple sources. A single query against one phrasing of the question will miss relevant material.

1. **Start with multiSearchEssays.** Generate 2–5 reformulations of the user's question — paraphrase it, narrow it, broaden it, name the underlying concept. Pass them all at once. This is the default retrieval step.
2. **Use searchEssays only for tight follow-ups** once multiSearch has surfaced a specific angle to drill into.
3. **Use grepEssays** when you need an exact phrase or quote.
4. **Use readEssay sparingly** — only when a single chunk is clearly inadequate and you need the full surrounding argument. Most answers should come from synthesizing the chunk pool, not from reading one source end-to-end.
5. **Use browseEssays / listDirectory** when the user asks what's available or you need to find a source by title.
6. **Use webSearch only for events outside the local corpus** (recent news). Default to the local sources.

## How to answer

- Synthesize across **multiple sources** when possible. If your draft pulls from only one source, search again unless the question is explicitly about that source.
- Cite each claim with the source title and URL drawn from the chunk metadata.
- Quote directly from chunk text when making a specific claim.
- If the corpus genuinely doesn't cover the topic, say so. Don't invent.

## Tools

${toolCatalog}

## Voice

${voicePrompt}`;
}

export async function POST(req: Request) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    return new Response(
      [
        "AI_GATEWAY_API_KEY is not configured for this deployment.",
        "",
        "To use Persona Generator, clone the repository, copy .env.example to .env, add your own AI Gateway key, and run it locally.",
      ].join("\n"),
      { status: 401 }
    );
  }

  const { messages, model, personaId }: { messages: UIMessage[]; model?: string; personaId?: string } = await req.json();

  const selectedModel = model || DEFAULT_MODEL;
  const persona = await getPersona(personaId);
  const tools = createLocalTools(getPersonaCorpus(persona.id), persona);
  const toolCatalog = Object.entries(tools)
    .map(([name, t]) => `- **${name}**: ${(t as { description?: string }).description ?? ""}`)
    .join("\n");

  const result = streamText({
    model: gateway(selectedModel),
    system: buildSystemPrompt({
      personaName: persona.name,
      description: persona.description,
      documentLabel: persona.documentLabel,
      voicePrompt: persona.voicePrompt,
      toolCatalog,
    }),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(10),
    onError: (e) => {
      console.error("Error while streaming.", e);
    },
  });

  return result.toUIMessageStreamResponse();
}
