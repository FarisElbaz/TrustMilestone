import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";

export interface Criterion {
  id: string;
  criterion: string;
  method: "test" | "code_review" | "manual";
  status: "ready" | "needs_clarification";
  source: string;
}
export interface Criteria {
  summary: string;
  criteria: Criterion[];
  open_questions: { question: string; affects: string[] }[];
  out_of_scope: string[];
}
export type ModelCall = (prompt: string, model: string, temperature: number) => Promise<string>;

export class CriteriaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CriteriaValidationError";
  }
}

async function defaultModelCall(prompt: string, model: string, temperature: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, responseMimeType: "application/json" }
    })
  });
  if (!response.ok) throw new Error(`Gemini request failed with HTTP ${response.status}`);
  const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function readTemplate(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "prompts/criteria_generator.md"),
    path.resolve(process.cwd(), "trustmilestone/backend/prompts/criteria_generator.md"),
    path.resolve(process.cwd(), "PayPalAI/trustmilestone/backend/prompts/criteria_generator.md")
  ];
  const found = candidates.find((candidate) => require("node:fs").existsSync(candidate));
  if (!found) throw new Error("Missing required prompts/criteria_generator.md");
  return fs.readFile(found, "utf8");
}

function validate(value: unknown): Criteria {
  if (!value || typeof value !== "object") throw new CriteriaValidationError("Criteria response must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || !Array.isArray(record.criteria) ||
      !Array.isArray(record.open_questions) || !Array.isArray(record.out_of_scope)) {
    throw new CriteriaValidationError("Criteria response is missing summary, criteria, open_questions, or out_of_scope");
  }
  const criteria = record.criteria.map((item, index) => {
    if (!item || typeof item !== "object") throw new CriteriaValidationError(`Invalid criterion at index ${index}`);
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.criterion !== "string" ||
        !["test", "code_review", "manual"].includes(String(c.method)) ||
        !["ready", "needs_clarification"].includes(String(c.status)) || typeof c.source !== "string") {
      throw new CriteriaValidationError(`Invalid criterion at index ${index}`);
    }
    return c as unknown as Criterion;
  });
  return { summary: record.summary, criteria, open_questions: record.open_questions as Criteria["open_questions"], out_of_scope: record.out_of_scope as string[] };
}

export async function generateCriteria(briefText: string, stack: string, call: ModelCall = defaultModelCall): Promise<Criteria> {
  const template = await readTemplate();
  const prompt = template.replace("{{CLIENT_REQUEST}}", briefText).replace("{{STACK_AND_CONSTRAINTS}}", stack);
  let raw: string;
  try {
    raw = await call(prompt, loadConfig().criteria_generator.model, 0);
  } catch (error) {
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CriteriaValidationError("Criteria model returned invalid JSON");
  }
  return validate(parsed);
}
