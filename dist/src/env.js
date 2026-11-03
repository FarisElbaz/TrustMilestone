"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvironment = loadEnvironment;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
let loaded = false;
function parseLine(line) {
    const match = line.replace(/^\uFEFF/, "").match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!match)
        return undefined;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    return [match[1], value];
}
function loadEnvironment() {
    if (loaded)
        return;
    loaded = true;
    if (process.env.NODE_ENV === "test")
        return;
    const candidates = [
        node_path_1.default.resolve(".env"),
        node_path_1.default.resolve("trustmilestone", "backend", ".env"),
        node_path_1.default.resolve(__dirname, "..", "trustmilestone", "backend", ".env")
    ];
    for (const filename of candidates) {
        if (!node_fs_1.default.existsSync(filename))
            continue;
        for (const line of node_fs_1.default.readFileSync(filename, "utf8").split(/\r?\n/)) {
            const entry = parseLine(line);
            if (entry && !process.env[entry[0]])
                process.env[entry[0]] = entry[1];
        }
        break;
    }
    const aliases = {
        BUYER_EMAIL: "PAYPAL_BUYER_EMAIL",
        CONTRACTOR_EMAIL: "PAYPAL_CONTRACTOR_EMAIL",
        BUSINESS_EMAIL: "PAYPAL_BUSINESS_EMAIL",
        PAYPALCURRENCY: "PAYPAL_CURRENCY"
    };
    for (const [source, target] of Object.entries(aliases)) {
        if (!process.env[target] && process.env[source])
            process.env[target] = process.env[source];
    }
}
