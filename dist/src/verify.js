"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verify = verify;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./config");
const criteria_approval_1 = require("./criteria-approval");
const sandbox_1 = require("./sandbox");
const judge_1 = require("./judge");
const route_1 = require("./route");
const milestone_1 = require("./milestone");
const review_handoff_1 = require("./review-handoff");
const config_2 = require("./paypal/config");
function criterionTokens(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function mapCriterionToRequirements(criterion, results) {
    const available = [...new Set(results.map((result) => result.requirementId).filter((id) => Boolean(id)))];
    const direct = results.filter((result) => result.requirementId === criterion.id || result.requirementId === criterion.id.replace("C", "REQ-"));
    if (direct.length > 0)
        return [...new Set(direct.map((result) => result.requirementId).filter((id) => Boolean(id)))];
    const criterionWords = criterionTokens(`${criterion.criterion} ${criterion.source ?? ""}`);
    const scored = available.map((requirementId) => {
        const matches = results.filter((result) => result.requirementId === requirementId);
        const score = matches.reduce((total, result) => {
            const testWords = criterionTokens(result.name);
            return total + [...criterionWords].filter((word) => word.length > 2 && testWords.has(word)).length;
        }, 0);
        return { requirementId, score };
    }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
    return scored.length > 0 ? [scored[0].requirementId] : [];
}
async function verify(caseDir, submissionDir, options = {}) {
    const caseId = node_path_1.default.basename(caseDir);
    (0, config_2.validatePaymentEnvironment)();
    const manifest = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(caseDir, "manifest.json"), "utf8"));
    const criteria = await (0, criteria_approval_1.readStoredCriteria)(caseId);
    if (criteria.status !== "approved")
        throw new Error(`Criteria for case ${caseId} must be approved before verification (status: ${criteria.status}).`);
    const config = (0, config_1.loadConfig)();
    const metadata = { caseId, submissionPath: node_path_1.default.resolve(submissionDir), timestamp: new Date().toISOString(), models: { criteria_generator: config.criteria_generator.model, code_review_judge: config.code_review_judge.model } };
    const outDir = node_path_1.default.resolve("out", caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    if (options.currency)
        process.env.PAYPAL_CURRENCY = options.currency;
    const amount = options.amount ?? process.env.PAYPAL_AMOUNT ?? "10.00";
    const paymentCaseId = options.paymentCaseId ?? caseId;
    if ((process.env.PAYMENT_MODE ?? "mock") === "mock")
        await (0, milestone_1.fundCase)(paymentCaseId, amount, options.currency);
    else
        await (0, milestone_1.paymentStatus)(paymentCaseId, options.buyerEmail);
    const outcomes = [];
    const testCriteria = criteria.criteria.filter((criterion) => criterion.method === "test");
    if (testCriteria.length > 0) {
        const declaredTests = node_path_1.default.join(caseDir, "tests");
        const testDir = await promises_1.default.access(declaredTests).then(() => declaredTests).catch(() => node_path_1.default.join(caseDir, "reference", "tests"));
        const results = await (0, sandbox_1.runTests)(submissionDir, testDir);
        for (const criterion of testCriteria) {
            const mappedRequirements = mapCriterionToRequirements(criterion, results);
            const matching = results.filter((result) => result.requirementId && mappedRequirements.includes(result.requirementId));
            outcomes.push({ id: criterion.id, method: "test", result: matching.some((result) => result.status === "failed") ? "fail" : matching.length ? "pass" : "unclear", evidence: matching });
        }
    }
    for (const criterion of criteria.criteria.filter((item) => item.method === "code_review")) {
        const judged = await (0, judge_1.judgeCriterion)(criterion, submissionDir, options.judgeCall);
        outcomes.push({ id: criterion.id, method: "code_review", result: judged.combined === "decided" ? judged.result : "unclear", evidence: judged });
    }
    for (const criterion of criteria.criteria.filter((item) => item.method === "manual"))
        outcomes.push({ id: criterion.id, method: "manual", result: "unclear", evidence: "manual review required" });
    const decision = (0, route_1.route)(outcomes);
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "result.json"), JSON.stringify({ ...metadata, ...decision, outcomes }, null, 2));
    if (decision.decision === "release")
        await (0, milestone_1.releaseMilestone)(paymentCaseId, amount, 1, options.contractorEmail);
    else if (decision.decision === "reject")
        await (0, milestone_1.rejectMilestone)(paymentCaseId);
    else {
        await (0, milestone_1.holdMilestone)(paymentCaseId, new Date(Date.now() + 24 * 60 * 60 * 1000));
        await (0, review_handoff_1.writeEscalationReview)(caseId, node_path_1.default.resolve(submissionDir), outcomes, await (0, milestone_1.getPaymentRecord)(paymentCaseId));
    }
    return decision;
}
