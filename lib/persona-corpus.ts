import { corpus, createCorpus, type Corpus } from "./corpus";
import { xenovaMiniLM } from "./embedder";
import { DEFAULT_PERSONA_ID, personaPaths, safePersonaId } from "./personas";

const embedder = xenovaMiniLM();
const personaCorpora = new Map<string, Corpus>();

export function getPersonaCorpus(personaId: string | undefined): Corpus {
  const id = safePersonaId(personaId || DEFAULT_PERSONA_ID);
  if (id === DEFAULT_PERSONA_ID) return corpus;

  const cached = personaCorpora.get(id);
  if (cached) return cached;

  const { documentsDir, indexDir } = personaPaths(id);
  const nextCorpus = createCorpus({
    embedder,
    essaysDir: documentsDir,
    indexDir,
  });
  personaCorpora.set(id, nextCorpus);
  return nextCorpus;
}

export function clearPersonaCorpus(personaId: string) {
  personaCorpora.delete(safePersonaId(personaId));
}
