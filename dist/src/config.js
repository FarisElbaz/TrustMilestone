"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
    }
    return parsed;
}
