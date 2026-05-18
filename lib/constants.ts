export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";
export const SUPPORTED_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "moonshotai/kimi-k2-thinking",
  "xai/grok-4-fast-reasoning",
  "alibaba/qwen3-vl-thinking",
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const MODEL_DISPLAY_NAMES: Record<SupportedModel, string> = {
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "moonshotai/kimi-k2-thinking": "Kimi K2 Thinking",
  "xai/grok-4-fast-reasoning": "Grok 4 Fast Reasoning",
  "alibaba/qwen3-vl-thinking": "Qwen3 VL Thinking",
};

export const MODEL_LOGOS: Record<SupportedModel, string> = {
  "anthropic/claude-sonnet-4.5": "/claude.png",
  "moonshotai/kimi-k2-thinking": "/kimi.png",
  "xai/grok-4-fast-reasoning": "/xai.png",
  "alibaba/qwen3-vl-thinking": "/alibaba.png",
};
