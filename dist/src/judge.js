"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.judgeCriterion = judgeCriterion;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
async function defaultCall(prompt, model, temperature) {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
        throw new Error("GEMINI_API_KEY is required");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, responseMimeType: "application/json" } })
    });
    if (!response.ok)
        throw new Error(`Gemini request failed with HTTP ${response.status}`);
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
        throw new Error("Gemini returned no text");
    return text;
}
async function judgeCriterion(criterion, submissionDir, call = defaultCall) {
    const files = await collectFiles(submissionDir);
    const source = (await Promise.all(files.map(async (file) => `FILE: ${node_path_1.default.relative(submissionDir, file)}\n${await promises_1.default.readFile(file, "utf8")}`))).join("\n\n");
    const prompt = `Return JSON only: {"verdict":"pass|fail|unclear","reason":"...","files":["..."]}. Judge criterion ${criterion.id}: ${criterion.criterion}\n${source}`;
    const verdicts = [];
    for (let i = 0; i < 3; i++) {
        const raw = await (0, config_1.withModelFallback)((0, config_1.modelChain)((0, config_1.loadConfig)().code_review_judge), (model) => call(prompt, model, 0));
        verdicts.push(parseJudgeVerdict(raw));
    }
    const same = verdicts[0].verdict === verdicts[1].verdict && verdicts[1].verdict === verdicts[2].verdict;
    return { verdicts, combined: same ? "decided" : "unclear", result: same ? verdicts[0].verdict : "unclear" };
}
/** A malformed judge answer is treated as an uncertain verdict, so the case escalates to the client instead of crashing verification. */
function parseJudgeVerdict(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { verdict: "unclear", reason: "Judge response was not valid JSON.", files: [] };
    }
    const value = (Array.isArray(parsed) ? parsed[0] : parsed);
    if (!value || !["pass", "fail", "unclear"].includes(value.verdict) || typeof value.reason !== "string") {
        return { verdict: "unclear", reason: "Judge response did not match the expected verdict format.", files: [] };
    }
    return { verdict: value.verdict, reason: value.reason, files: Array.isArray(value.files) ? value.files.filter((f) => typeof f === "string") : [] };
}
async function collectFiles(dir) {
    const entries = await promises_1.default.readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? collectFiles(node_path_1.default.join(dir, entry.name)) : /\.(ts|js|tsx|jsx|json)$/.test(entry.name) ? [node_path_1.default.join(dir, entry.name)] : []));
    return nested.flat();
}
