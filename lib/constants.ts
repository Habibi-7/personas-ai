export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

// Curated for tool-use reliability + a cheap option for testing.
export const SUPPORTED_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "xai/grok-4-fast-reasoning",
  "moonshotai/kimi-k2-thinking",
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const MODEL_DISPLAY_NAMES: Record<SupportedModel, string> = {
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "anthropic/claude-haiku-4.5": "Claude Haiku 4.5 (cheap)",
  "xai/grok-4-fast-reasoning": "Grok 4 Fast",
  "moonshotai/kimi-k2-thinking": "Kimi K2 Thinking",
};

export const MODEL_LOGOS: Record<SupportedModel, string> = {
  "anthropic/claude-sonnet-4.5": "/claude.png",
  "anthropic/claude-haiku-4.5": "/claude.png",
  "xai/grok-4-fast-reasoning": "/xai.png",
  "moonshotai/kimi-k2-thinking": "/kimi.png",
};
