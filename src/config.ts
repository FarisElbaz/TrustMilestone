import fs from "node:fs";
import path from "node:path";

export interface ModelConfig {
  provider: string;
  model: string;
  temperature: number;
  response_format: string;
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
  }
  return parsed as AppConfig;
}
