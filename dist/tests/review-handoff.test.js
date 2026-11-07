"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const review_handoff_1 = require("../src/review-handoff");
const caseId = "review-test";
const output = node_path_1.default.resolve("out", caseId);
const payment = {
    caseId, amount: "10.00", currency: "USD", createdAt: new Date().toISOString(),
    authorizedAt: new Date().toISOString(),
    authorizationId: "auth-review", authorizationExpirationTime: new Date(Date.now() + 86400000).toISOString(),
    authorizationStatus: "AUTHORIZED", milestones: []
};
const outcomes = [{ id: "C1", method: "manual", result: "unclear", evidence: "human check" }];
beforeEach(async () => {
    await promises_1.default.rm(output, { recursive: true, force: true });
    await promises_1.default.mkdir(output, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(output, "paypal.json"), JSON.stringify(payment));
});
afterAll(async () => { await promises_1.default.rm(output, { recursive: true, force: true }); });
test("writes JSON and markdown escalation handoff", async () => {
    await (0, review_handoff_1.writeEscalationReview)(caseId, "submission", outcomes, payment);
    const review = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(output, "review.json"), "utf8"));
    const markdown = await promises_1.default.readFile(node_path_1.default.join(output, "review.md"), "utf8");
    expect(review).toMatchObject({ caseId, status: "pending", authorizationId: "auth-review" });
    expect(review.criteria[0]).toMatchObject({ id: "C1", verdict: "unclear", reason: expect.any(String) });
    expect(markdown).toContain("# Human review: review-test");
});
test("resolves release and refuses double resolution", async () => {
    await (0, review_handoff_1.writeEscalationReview)(caseId, "submission", outcomes, payment);
    await expect((0, review_handoff_1.resolveReviewHandoff)(caseId, "release", "reviewer")).resolves.toMatchObject({ status: "resolved", decision: "release" });
    await expect((0, review_handoff_1.resolveReviewHandoff)(caseId, "release")).rejects.toThrow("already resolved");
});
test("reject after capture becomes needs_review without a PayPal operation", async () => {
    const captured = { ...payment, milestones: [{ number: 1, amount: "1.00", captureId: "capture-1", status: "released", timestamp: new Date().toISOString() }] };
    await promises_1.default.writeFile(node_path_1.default.join(output, "paypal.json"), JSON.stringify(captured));
    await (0, review_handoff_1.writeEscalationReview)(caseId, "submission", outcomes, captured);
    await expect((0, review_handoff_1.resolveReviewHandoff)(caseId, "reject")).rejects.toThrow("no PayPal call was made");
    await expect(promises_1.default.readFile(node_path_1.default.join(output, "review.json"), "utf8")).resolves.toContain('"status": "needs_review"');
    await expect(promises_1.default.readFile(node_path_1.default.join(output, "paypal.json"), "utf8")).resolves.toContain("manual refund decision is required");
});
test("refuses expired authorization", async () => {
    const expired = { ...payment, authorizationExpirationTime: new Date(Date.now() - 1000).toISOString() };
    await promises_1.default.writeFile(node_path_1.default.join(output, "paypal.json"), JSON.stringify(expired));
    await (0, review_handoff_1.writeEscalationReview)(caseId, "submission", outcomes, expired);
    await expect((0, review_handoff_1.resolveReviewHandoff)(caseId, "release")).rejects.toThrow("expired");
});
