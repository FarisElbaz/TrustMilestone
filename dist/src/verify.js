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
const paths_1 = require("./paths");
function criterionTokens(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function mapCriterionToTests(criterion, manifestRequirements, results) {
    // 1. Check if criterion has a requirement ID directly (REQ-n)
    let reqId = criterion.requirementId ??
        criterion.id.match(/^REQ-\d+$/i)?.[0]?.toUpperCase() ??
        criterion.source?.match(/REQ-\d+/i)?.[0]?.toUpperCase() ??
        criterion.criterion.match(/REQ-\d+/i)?.[0]?.toUpperCase();
    // If not directly specified, match through the case manifest's requirement list
    let matchedManifestReq;
    if (!reqId && manifestRequirements.length > 0) {
        const criterionWords = criterionTokens(`${criterion.criterion} ${criterion.source ?? ""}`);
        const scoredReqs = manifestRequirements
            .map((req) => {
            const reqWords = criterionTokens(req.text);
            const score = [...criterionWords].filter((w) => w.length > 2 && reqWords.has(w)).length;
            return { req, score };
        })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score);
        if (scoredReqs.length > 0) {
            reqId = scoredReqs[0].req.id;
            matchedManifestReq = scoredReqs[0].req;
        }
    }
    // If we have a requirement ID, find test results matching this requirement ID
    if (reqId) {
        const matchingByReq = results.filter((r) => r.requirementId?.toUpperCase() === reqId?.toUpperCase());
        if (matchingByReq.length > 0) {
            return {
                matching: matchingByReq,
                matchRecord: {
                    type: "requirement",
                    requirementId: reqId,
                    manifestText: matchedManifestReq?.text,
                    matchedTests: matchingByReq.map((t) => t.name)
                }
            };
        }
    }
    // 2. If a criterion has no requirement ID, match it by its text against the test names
    const criterionWords = criterionTokens(`${criterion.criterion} ${criterion.source ?? ""}`);
    const scoredTests = results
        .map((test) => {
        const testWords = criterionTokens(test.name);
        const score = [...criterionWords].filter((w) => w.length > 2 && testWords.has(w)).length;
        return { test, score };
    })
        .sort((a, b) => b.score - a.score);
    const topScore = scoredTests[0]?.score ?? 0;
    const matchingByText = topScore > 0 ? scoredTests.filter((s) => s.score === topScore).map((s) => s.test) : results;
    return {
        matching: matchingByText,
        matchRecord: {
            type: "test_name",
            requirementId: reqId,
            matchedTests: matchingByText.map((t) => t.name)
        }
    };
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
    const outDir = node_path_1.default.resolve((0, paths_1.outputRoot)(), caseId);
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
        const manifestRequirements = manifest.requirements ?? [];
        let results = [];
        let runnerError;
        try {
            results = await (0, sandbox_1.runTests)(submissionDir, testDir);
        }
        catch (error) {
            runnerError = error instanceof Error ? error.message : String(error);
        }
        if (runnerError) {
            for (const criterion of testCriteria) {
                outcomes.push({
                    id: criterion.id,
                    method: "test",
                    result: "fail",
                    reason: runnerError,
                    evidence: { error: runnerError }
                });
            }
        }
        else {
            // Ensure test results have requirementId resolved if missing
            try {
                const testFiles = await promises_1.default.readdir(testDir);
                const source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => promises_1.default.readFile(node_path_1.default.join(testDir, f), "utf8")))).join("\n");
                for (const r of results) {
                    if (!r.requirementId) {
                        const escaped = r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const pattern = new RegExp(`(?:test|it)\\s*\\(\\s*["'\`]` + escaped + `["'\`]`, "i");
                        const match = pattern.exec(source);
                        const snippet = match ? source.slice(match.index, match.index + 1000) : source;
                        const req = snippet.match(/\/\/\s*(REQ-\d+)/i)?.[1]?.toUpperCase();
                        if (req)
                            r.requirementId = req;
                    }
                }
            }
            catch { }
            for (const criterion of testCriteria) {
                const { matching, matchRecord } = mapCriterionToTests(criterion, manifestRequirements, results);
                const hasFailed = matching.some((result) => result.status === "failed");
                const allPassed = matching.length > 0 && matching.every((result) => result.status === "passed");
                const result = hasFailed ? "fail" : allPassed ? "pass" : "fail";
                const reason = hasFailed
                    ? `Failed test: ${matching.filter((r) => r.status === "failed").map((r) => r.name).join(", ")}`
                    : allPassed
                        ? `All matching tests passed: ${matching.map((r) => r.name).join(", ")}`
                        : "No tests matched criterion";
                outcomes.push({
                    id: criterion.id,
                    method: "test",
                    result,
                    reason,
                    match: matchRecord,
                    evidence: matching
                });
            }
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
