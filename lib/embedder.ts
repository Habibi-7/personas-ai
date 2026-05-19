/**
 * Embedder seam. See CONTEXT.md → Embedder.
 *
 * Single concrete adapter today (Xenova MiniLM-L6-v2). The interface exists so
 * the Corpus and the index-build script consume the same shape, and so tests
 * can substitute deterministic stubs.
 */

export type Embedder = (text: string) => Promise<number[]>;

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";

export function xenovaMiniLM(model: string = DEFAULT_MODEL): Embedder {
  let pipePromise: Promise<(text: string, opts: { pooling: "mean"; normalize: true }) => Promise<{ data: Float32Array }>> | null = null;

  function getPipe() {
    if (!pipePromise) {
      pipePromise = (async () => {
        const { pipeline, env } = await import("@xenova/transformers");
        env.allowLocalModels = false;
        env.useBrowserCache = false;
        return (await pipeline("feature-extraction", model)) as unknown as (
          text: string,
          opts: { pooling: "mean"; normalize: true }
        ) => Promise<{ data: Float32Array }>;
      })();
    }
    return pipePromise;
  }

  return async (text: string) => {
    const pipe = await getPipe();
    const out = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  };
}
