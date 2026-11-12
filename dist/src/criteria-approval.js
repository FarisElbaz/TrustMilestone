"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.criteriaPath = void 0;
exports.readStoredCriteria = readStoredCriteria;
exports.proposeCriteria = proposeCriteria;
exports.approveStoredCriteria = approveStoredCriteria;
exports.invalidateCriteria = invalidateCriteria;
exports.formatCriteria = formatCriteria;
exports.generateAndApproveCriteria = generateAndApproveCriteria;
exports.criteriaModelName = criteriaModelName;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const criteria_1 = require("./criteria");
const config_1 = require("./config");
const paths_1 = require("./paths");
const criteriaPath = (caseId) => node_path_1.default.resolve((0, paths_1.outputRoot)(), caseId, "criteria.json");
exports.criteriaPath = criteriaPath;
async function writeCriteria(caseId, criteria) {
    await promises_1.default.mkdir(node_path_1.default.dirname((0, exports.criteriaPath)(caseId)), { recursive: true });
    await promises_1.default.writeFile((0, exports.criteriaPath)(caseId), JSON.stringify(criteria, null, 2));
}
async function readStoredCriteria(caseId) {
    try {
        return JSON.parse(await promises_1.default.readFile((0, exports.criteriaPath)(caseId), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT") {
            throw new Error(`No criteria file exists for case ${caseId}; run npm run criteria -- --case ${caseId}.`);
        }
        throw new Error(`Unable to read criteria for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function proposeCriteria(caseId, briefText, stack, modelCall) {
    const generated = await (0, criteria_1.generateCriteria)(briefText, stack, modelCall);
    const proposed = {
        caseId,
        ...generated,
        status: "proposed",
        proposedAt: new Date().toISOString()
    };
    await writeCriteria(caseId, proposed);
    return proposed;
}
async function approveStoredCriteria(caseId, operatorName = process.env.OPERATOR_NAME ?? "unknown") {
    const criteria = await readStoredCriteria(caseId);
    const approved = {
        ...criteria,
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: operatorName
    };
    await writeCriteria(caseId, approved);
    return approved;
}
async function invalidateCriteria(caseId) {
    const criteria = await readStoredCriteria(caseId);
    const invalidated = {
        ...criteria,
        status: "proposed",
        proposedAt: new Date().toISOString(),
        approvedAt: undefined,
        approvedBy: undefined
    };
    await writeCriteria(caseId, invalidated);
    return invalidated;
}
function formatCriteria(criteria) {
    const lines = criteria.criteria.map((item) => `${item.id}: ${item.criterion} [${item.method}]`);
    if (criteria.open_questions.length) {
        lines.push("Open questions:");
        lines.push(...criteria.open_questions.map((item) => `- ${item.question}`));
    }
    return lines.join("\n");
}
async function generateAndApproveCriteria(caseId, briefText, stack, prompt, modelCall) {
    let current = await proposeCriteria(caseId, briefText, stack, modelCall);
    while (true) {
        console.log(formatCriteria(current));
        const decision = (await prompt('Type "approve", "revise", or "cancel": ')).trim().toLowerCase();
        if (decision === "approve")
            return approveStoredCriteria(caseId);
        if (decision === "cancel") {
            current.status = "cancelled";
            await writeCriteria(caseId, current);
            return undefined;
        }
        if (decision !== "revise") {
            console.log('Please type "approve", "revise", or "cancel".');
            continue;
        }
        const note = await prompt("Revision note: ");
        current = await proposeCriteria(caseId, `${briefText}\n\nClient revision note:\n${note}`, stack, modelCall);
    }
}
function criteriaModelName() {
    return (0, config_1.loadConfig)().criteria_generator.model;
}
