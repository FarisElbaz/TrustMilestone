import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, modelChain, withModelFallback } from "./config";

export type Verdict = "pass" | "fail" | "unclear";
export interface JudgeVerdict { verdict: Verdict; reason: string; files: string[]; }
export interface JudgeResult { verdicts: JudgeVerdict[]; combined: "decided" | "unclear"; result: Verdict; }
export type JudgeModelCall = (prompt: string, model: string, temperature: number) => Promise<string>;

async function defaultCall(prompt: string, model: string, temperature: number): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is required");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, responseMimeType: "application/json" } })
  });
  if (!response.ok) throw new Error(`Gemini request failed with HTTP ${response.status}`);
  const body = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

export async function judgeCriterion(criterion: { id: string; criterion: string }, submissionDir: string, call: JudgeModelCall = defaultCall): Promise<JudgeResult> {
  const files = await collectFiles(submissionDir);
  const source = (await Promise.all(files.map(async (file) => `FILE: ${path.relative(submissionDir, file)}\n${await fs.readFile(file, "utf8")}`))).join("\n\n");
  const prompt = `Return JSON only: {"verdict":"pass|fail|unclear","reason":"...","files":["..."]}. Judge criterion ${criterion.id}: ${criterion.criterion}\n${source}`;
  const verdicts: JudgeVerdict[] = [];
  for (let i = 0; i < 3; i++) {
    const raw = await withModelFallback(modelChain(loadConfig().code_review_judge), (model) => call(prompt, model, 0));
    verdicts.push(parseJudgeVerdict(raw));
  }
  const same = verdicts[0].verdict === verdicts[1].verdict && verdicts[1].verdict === verdicts[2].verdict;
  return { verdicts, combined: same ? "decided" : "unclear", result: same ? verdicts[0].verdict : "unclear" };
}

/** A malformed judge answer is treated as an uncertain verdict, so the case escalates to the client instead of crashing verification. */
function parseJudgeVerdict(raw: string): JudgeVerdict {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { verdict: "unclear", reason: "Judge response was not valid JSON.", files: [] }; }
  const value = (Array.isArray(parsed) ? parsed[0] : parsed) as Partial<JudgeVerdict> | undefined;
  if (!value || !["pass", "fail", "unclear"].includes(value.verdict as string) || typeof value.reason !== "string") {
    return { verdict: "unclear", reason: "Judge response did not match the expected verdict format.", files: [] };
  }
  return { verdict: value.verdict as Verdict, reason: value.reason, files: Array.isArray(value.files) ? value.files.filter((f): f is string => typeof f === "string") : [] };
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? collectFiles(path.join(dir, entry.name)) : /\.(ts|js|tsx|jsx|json)$/.test(entry.name) ? [path.join(dir, entry.name)] : []));
  return nested.flat();
}
