"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelChain = modelChain;
exports.withModelFallback = withModelFallback;
exports.loadConfig = loadConfig;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Main model first, then any configured fallbacks (deduplicated). */
function modelChain(config) {
    return [...new Set([config.model, ...(config.fallback_models ?? [])])];
}
const FALLBACK_STATUS = /HTTP (404|429|500|503)\b/;
/** Calls `fn` with each model in turn, moving to the next only on an unavailable/unknown-model HTTP error. */
async function withModelFallback(models, fn, passes = 2, pauseMs = 3000) {
    let lastError;
    for (let pass = 0; pass < passes; pass++) {
        if (pass > 0)
            await new Promise((resolve) => setTimeout(resolve, pauseMs));
        for (const model of models) {
            try {
                return await fn(model);
            }
            catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                if (!FALLBACK_STATUS.test(message))
                    throw error;
            }
        }
    }
    throw lastError;
}
function configPath() {
    const candidates = [
        node_path_1.default.resolve(process.cwd(), "config/models.json"),
        node_path_1.default.resolve(process.cwd(), "trustmilestone/backend/config/models.json"),
        node_path_1.default.resolve(process.cwd(), "PayPalAI/trustmilestone/backend/config/models.json")
    ];
    const found = candidates.find((candidate) => node_fs_1.default.existsSync(candidate));
    if (!found)
        throw new Error("Missing required config/models.json");
    return found;
}
function loadConfig() {
    let parsed;
    try {
        parsed = JSON.parse(node_fs_1.default.readFileSync(configPath(), "utf8"));
    }
    catch (error) {
        throw new Error(`Unable to load config/models.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object")
        throw new Error("config/models.json must contain an object");
    const value = parsed;
    for (const key of ["criteria_generator", "code_review_judge"]) {
        const model = value[key];
        if (!model || typeof model !== "object" || typeof model.model !== "string" ||
            !model.model) {
            throw new Error(`Missing required model configuration or model name: ${key}`);
        }
        const fallbacks = model.fallback_models;
        if (fallbacks !== undefined && (!Array.isArray(fallbacks) || !fallbacks.every((m) => typeof m === "string" && m))) {
            throw new Error(`fallback_models must be an array of model names: ${key}`);
        }
    }
    return parsed;
}
