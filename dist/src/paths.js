"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.outputRoot = outputRoot;
const node_path_1 = __importDefault(require("node:path"));
function outputRoot() {
    return node_path_1.default.resolve(process.env.OUTPUT_ROOT ?? "out");
}
