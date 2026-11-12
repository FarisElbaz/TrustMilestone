import fs from "node:fs/promises";
import path from "node:path";
import { writeEscalationReview, resolveReviewHandoff } from "../src/review-handoff";

const caseId = "review-test";
const output = path.resolve("out", caseId);
const payment = {
  caseId, amount: "10.00", currency: "USD", createdAt: new Date().toISOString(),
  authorizedAt: new Date().toISOString(),
  authorizationId: "auth-review", authorizationExpirationTime: new Date(Date.now() + 86400000).toISOString(),
  authorizationStatus: "AUTHORIZED", milestones: []
};
const outcomes = [{ id: "C1", method: "manual" as const, result: "unclear" as const, evidence: "human check" }];

beforeEach(async () => {
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "paypal.json"), JSON.stringify(payment));
});
afterAll(async () => { await fs.rm(output, { recursive: true, force: true }); });

test("writes JSON and markdown escalation handoff", async () => {
  await writeEscalationReview(caseId, "submission", outcomes, payment);
  const review = JSON.parse(await fs.readFile(path.join(output, "review.json"), "utf8"));
  const markdown = await fs.readFile(path.join(output, "review.md"), "utf8");
  expect(review).toMatchObject({ caseId, status: "pending", authorizationId: "auth-review" });
  expect(review.criteria[0]).toMatchObject({ id: "C1", verdict: "unclear", reason: expect.any(String) });
  expect(markdown).toContain("# Human review: review-test");
});

test("resolves release and refuses double resolution", async () => {
  await writeEscalationReview(caseId, "submission", outcomes, payment);
  await expect(resolveReviewHandoff(caseId, "release", "reviewer")).resolves.toMatchObject({ status: "resolved", decision: "release" });
  await expect(resolveReviewHandoff(caseId, "release")).rejects.toThrow("already resolved");
});

test("resolves reject by voiding the authorization and refuses a second decision", async () => {
  await writeEscalationReview(caseId, "submission", outcomes, payment);
  await expect(resolveReviewHandoff(caseId, "reject", "reviewer")).resolves.toMatchObject({ status: "resolved", decision: "reject" });
  await expect(fs.readFile(path.join(output, "paypal.json"), "utf8")).resolves.toContain('"voidedAt"');
  await expect(resolveReviewHandoff(caseId, "release")).rejects.toThrow("already resolved");
});

test("reject after capture becomes needs_review without a PayPal operation", async () => {
  const captured = { ...payment, milestones: [{ number: 1, amount: "1.00", captureId: "capture-1", status: "released" as const, timestamp: new Date().toISOString() }] };
  await fs.writeFile(path.join(output, "paypal.json"), JSON.stringify(captured));
  await writeEscalationReview(caseId, "submission", outcomes, captured);
  await expect(resolveReviewHandoff(caseId, "reject")).rejects.toThrow("no PayPal call was made");
  await expect(fs.readFile(path.join(output, "review.json"), "utf8")).resolves.toContain('"status": "needs_review"');
  await expect(fs.readFile(path.join(output, "paypal.json"), "utf8")).resolves.toContain("manual refund decision is required");
});

test("refuses expired authorization", async () => {
  const expired = { ...payment, authorizationExpirationTime: new Date(Date.now() - 1000).toISOString() };
  await fs.writeFile(path.join(output, "paypal.json"), JSON.stringify(expired));
  await writeEscalationReview(caseId, "submission", outcomes, expired);
  await expect(resolveReviewHandoff(caseId, "release")).rejects.toThrow("expired");
});
