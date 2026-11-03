"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CriteriaValidationError = void 0;
exports.generateCriteria = generateCriteria;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
class CriteriaValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "CriteriaValidationError";
    }
}
exports.CriteriaValidationError = CriteriaValidationError;
async function defaultModelCall(prompt, model, temperature) {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
        throw new Error("GEMINI_API_KEY is required");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature, responseMimeType: "application/json" }
        })
    });
    if (!response.ok)
        throw new Error(`Gemini request failed with HTTP ${response.status}`);
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
        throw new Error("Gemini returned no text");
    return text;
}
async function readTemplate() {
    const candidates = [
        node_path_1.default.resolve(process.cwd(), "prompts/criteria_generator.md"),
        node_path_1.default.resolve(process.cwd(), "trustmilestone/backend/prompts/criteria_generator.md"),
        node_path_1.default.resolve(process.cwd(), "PayPalAI/trustmilestone/backend/prompts/criteria_generator.md")
    ];
    const found = candidates.find((candidate) => require("node:fs").existsSync(candidate));
    if (!found)
        throw new Error("Missing required prompts/criteria_generator.md");
    return promises_1.default.readFile(found, "utf8");
}
function validate(value) {
    if (!value || typeof value !== "object")
        throw new CriteriaValidationError("Criteria response must be an object");
    const record = value;
    if (typeof record.summary !== "string" || !Array.isArray(record.criteria) ||
        !Array.isArray(record.open_questions) || !Array.isArray(record.out_of_scope)) {
        throw new CriteriaValidationError("Criteria response is missing summary, criteria, open_questions, or out_of_scope");
    }
    const criteria = record.criteria.map((item, index) => {
        if (!item || typeof item !== "object")
            throw new CriteriaValidationError(`Invalid criterion at index ${index}`);
        const c = item;
        if (typeof c.id !== "string" || typeof c.criterion !== "string" ||
            !["test", "code_review", "manual"].includes(String(c.method)) ||
            !["ready", "needs_clarification"].includes(String(c.status)) || typeof c.source !== "string") {
            throw new CriteriaValidationError(`Invalid criterion at index ${index}`);
        }
        return c;
    });
    return { summary: record.summary, criteria, open_questions: record.open_questions, out_of_scope: record.out_of_scope };
}
async function generateCriteria(briefText, stack, call = defaultModelCall) {
    const template = await readTemplate();
    const prompt = template.replace("{{CLIENT_REQUEST}}", briefText).replace("{{STACK_AND_CONSTRAINTS}}", stack);
    let raw;
    try {
        raw = await call(prompt, (0, config_1.loadConfig)().criteria_generator.model, 0);
    }
    catch (error) {
        throw error;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new CriteriaValidationError("Criteria model returned invalid JSON");
    }
    return validate(parsed);
}
