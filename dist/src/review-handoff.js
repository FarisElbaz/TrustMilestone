"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewMarkdownPath = exports.reviewPath = void 0;
exports.writeEscalationReview = writeEscalationReview;
exports.renderReviewMarkdown = renderReviewMarkdown;
exports.readReview = readReview;
exports.resolveReviewHandoff = resolveReviewHandoff;
exports.timeRemaining = timeRemaining;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("./milestone");
const reviewPath = (caseId) => node_path_1.default.resolve("out", caseId, "review.json");
exports.reviewPath = reviewPath;
const reviewMarkdownPath = (caseId) => node_path_1.default.resolve("out", caseId, "review.md");
exports.reviewMarkdownPath = reviewMarkdownPath;
function reasonFor(outcome) {
    if (outcome.method === "manual")
        return "Manual review is required.";
    if (outcome.result === "unclear")
        return "The automated evaluation was inconclusive.";
    return outcome.result === "pass" ? "Criterion passed." : "Criterion failed.";
}
async function writeEscalationReview(caseId, submissionPath, outcomes, paymentRecord) {
    const review = {
        caseId,
        submissionPath,
        escalatedAt: new Date().toISOString(),
        criteria: outcomes.map((outcome) => ({
            id: outcome.id,
            verdict: outcome.result,
            reason: reasonFor(outcome),
            evidence: outcome.evidence
        })),
        authorizationId: paymentRecord.authorizationId,
        expirationTime: paymentRecord.authorizationExpirationTime,
        status: "pending"
    };
    await promises_1.default.mkdir(node_path_1.default.dirname((0, exports.reviewPath)(caseId)), { recursive: true });
    await promises_1.default.writeFile((0, exports.reviewPath)(caseId), JSON.stringify(review, null, 2));
    await promises_1.default.writeFile((0, exports.reviewMarkdownPath)(caseId), renderReviewMarkdown(review));
    return review;
}
function renderReviewMarkdown(review) {
    const lines = [
        `# Human review: ${review.caseId}`,
        "",
        `- Status: ${review.status}`,
        `- Submission: ${review.submissionPath}`,
        `- Escalated: ${review.escalatedAt}`,
        `- Authorization: ${review.authorizationId ?? "none recorded"}`,
        `- Expires: ${review.expirationTime ?? "unknown"}`,
        ""
    ];
    for (const criterion of review.criteria) {
        lines.push(`## ${criterion.id}: ${criterion.verdict}`, criterion.reason, `Evidence: ${JSON.stringify(criterion.evidence)}`, "");
    }
    return lines.join("\n");
}
async function readReview(caseId) {
    try {
        return JSON.parse(await promises_1.default.readFile((0, exports.reviewPath)(caseId), "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            throw new Error(`No pending review exists for case ${caseId}.`);
        throw new Error(`Unable to read review for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function resolveReviewHandoff(caseId, decision, operator = process.env.OPERATOR_NAME ?? "unknown", contractorEmail = process.env.PAYPAL_CONTRACTOR_EMAIL) {
    const review = await readReview(caseId);
    if (review.status !== "pending")
        throw new Error(`Review for ${caseId} is already ${review.status}.`);
    if (review.expirationTime && Date.now() >= new Date(review.expirationTime).getTime())
        throw new Error(`Authorization for ${caseId} has expired.`);
    const payment = await (0, milestone_1.getPaymentRecord)(caseId);
    if (decision === "reject" && payment.milestones.length > 0) {
        await (0, milestone_1.markNeedsReview)(caseId, "Review reject requested after a capture; manual refund decision is required.");
        review.status = "needs_review";
        await promises_1.default.writeFile((0, exports.reviewPath)(caseId), JSON.stringify(review, null, 2));
        throw new Error("A capture already exists; review marked needs_review and no PayPal call was made.");
    }
    if (decision === "release")
        await (0, milestone_1.releaseMilestone)(caseId, payment.amount, 1, contractorEmail);
    else
        await (0, milestone_1.rejectMilestone)(caseId);
    const updated = await (0, milestone_1.getPaymentRecord)(caseId);
    review.status = "resolved";
    review.decision = decision;
    review.decidedAt = new Date().toISOString();
    review.operator = operator;
    review.paypalIds = {
        authorizationId: updated.authorizationId,
        captureId: updated.milestones[updated.milestones.length - 1]?.captureId,
        payoutBatchId: updated.milestones[updated.milestones.length - 1]?.payoutBatchId
    };
    await promises_1.default.writeFile((0, exports.reviewPath)(caseId), JSON.stringify(review, null, 2));
    await promises_1.default.writeFile((0, exports.reviewMarkdownPath)(caseId), renderReviewMarkdown(review));
    return review;
}
function timeRemaining(expirationTime) {
    if (!expirationTime)
        return { milliseconds: Number.NaN, text: "unknown", warning: false };
    const milliseconds = new Date(expirationTime).getTime() - Date.now();
    const hours = Math.max(0, Math.floor(milliseconds / 3_600_000));
    const minutes = Math.max(0, Math.floor((milliseconds % 3_600_000) / 60_000));
    return { milliseconds, text: `${hours}h ${minutes}m`, warning: milliseconds < 24 * 3_600_000 };
}
