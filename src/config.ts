import fs from "node:fs";
import path from "node:path";

export interface ModelConfig {
  provider: string;
  model: string;
  fallback_models?: string[];
  temperature: number;
  response_format: string;
}

/** Main model first, then any configured fallbacks (deduplicated). */
export function modelChain(config: ModelConfig): string[] {
  return [...new Set([config.model, ...(config.fallback_models ?? [])])];
}

const FALLBACK_STATUS = /HTTP (404|429|500|503)\b/;

/** Calls `fn` with each model in turn, moving to the next only on an unavailable/unknown-model HTTP error. */
export async function withModelFallback<T>(models: string[], fn: (model: string) => Promise<T>, passes = 2, pauseMs = 3000): Promise<T> {
  let lastError: unknown;
  for (let pass = 0; pass < passes; pass++) {
    if (pass > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    for (const model of models) {
      try {
        return await fn(model);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!FALLBACK_STATUS.test(message)) throw error;
      }
    }
  }
  throw lastError;
}

export interface AppConfig {
  criteria_generator: ModelConfig;
  code_review_judge: ModelConfig;
}

function configPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "config/models.json"),
    path.resolve(process.cwd(), "trustmilestone/backend/config/models.json"),
    path.resolve(process.cwd(), "PayPalAI/trustmilestone/backend/config/models.json")
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Missing required config/models.json");
  return found;
}

export function loadConfig(): AppConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch (error) {
    throw new Error(`Unable to load config/models.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("config/models.json must contain an object");
  const value = parsed as Record<string, unknown>;
  for (const key of ["criteria_generator", "code_review_judge"]) {
    const model = value[key];
    if (!model || typeof model !== "object" || typeof (model as Record<string, unknown>).model !== "string" ||
        !(model as Record<string, unknown>).model) {
      throw new Error(`Missing required model configuration or model name: ${key}`);
    }
    const fallbacks = (model as Record<string, unknown>).fallback_models;
    if (fallbacks !== undefined && (!Array.isArray(fallbacks) || !fallbacks.every((m) => typeof m === "string" && m))) {
      throw new Error(`fallback_models must be an array of model names: ${key}`);
    }
  }
  return parsed as AppConfig;
}
