"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEvidence = readEvidence;
exports.writeEvidence = writeEvidence;
exports.recordContractorBalances = recordContractorBalances;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("../milestone");
const evidencePath = (caseId) => node_path_1.default.resolve("out", caseId, "evidence.json");
async function readEvidence(caseId) {
    try {
        return JSON.parse(await promises_1.default.readFile(evidencePath(caseId), "utf8"));
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        return { caseId, milestones: {}, updatedAt: new Date().toISOString() };
    }
}
async function writeEvidence(value) {
    await promises_1.default.mkdir(node_path_1.default.dirname(evidencePath(value.caseId)), { recursive: true });
    value.updatedAt = new Date().toISOString();
    await promises_1.default.writeFile(evidencePath(value.caseId), JSON.stringify(value, null, 2));
}
async function recordContractorBalances(caseId, milestoneNumber, before, after, record) {
    const beforeValue = Number(before);
    const afterValue = Number(after);
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue) || afterValue < beforeValue)
        throw new Error("Contractor after balance must be a number greater than or equal to the before balance.");
    const evidence = await readEvidence(caseId);
    const key = String(milestoneNumber);
    const item = evidence.milestones[key] ?? {};
    item.contractor = { before, after, enteredAt: new Date().toISOString() };
    item.checks = { ...(item.checks ?? {}), contractorBalance: afterValue - beforeValue >= Number(record.milestones.find((milestone) => milestone.number === milestoneNumber)?.amount ?? 0) };
    evidence.milestones[key] = item;
    const milestone = record.milestones.find((entry) => entry.number === milestoneNumber);
    if (milestone && item.checks.contractorBalance && item.checks.captureCompleted && item.checks.payoutSuccess && item.checks.businessBalance)
        milestone.status = "released";
    await (0, milestone_1.savePaymentRecord)(record);
    await writeEvidence(evidence);
    return evidence;
}
