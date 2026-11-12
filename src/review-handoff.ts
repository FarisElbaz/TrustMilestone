import fs from "node:fs/promises";
import path from "node:path";
import { getPaymentRecord, markNeedsReview, rejectMilestone, releaseMilestone, type PayPalRecord } from "./milestone";
import type { CriterionOutcome } from "./route";
import { outputRoot } from "./paths";

export interface ReviewCriterion {
  id: string;
  verdict: CriterionOutcome["result"];
  reason: string;
  evidence: unknown;
}
export interface ReviewRecord {
  caseId: string;
  submissionPath: string;
  escalatedAt: string;
  criteria: ReviewCriterion[];
  authorizationId?: string;
  expirationTime?: string;
  status: "pending" | "resolved" | "needs_review";
  decision?: "release" | "reject";
  decidedAt?: string;
  operator?: string;
  paypalIds?: { authorizationId?: string; captureId?: string; payoutBatchId?: string };
}

export const reviewPath = (caseId: string): string => path.resolve(outputRoot(), caseId, "review.json");
export const reviewMarkdownPath = (caseId: string): string => path.resolve(outputRoot(), caseId, "review.md");

function reasonFor(outcome: CriterionOutcome): string {
  if (outcome.reason) return outcome.reason;
  if (outcome.method === "manual") return "Manual review is required.";
  if (outcome.result === "unclear") return "The automated evaluation was inconclusive.";
  return outcome.result === "pass" ? "Criterion passed." : "Criterion failed.";
}

export async function writeEscalationReview(
  caseId: string,
  submissionPath: string,
  outcomes: CriterionOutcome[],
  paymentRecord: PayPalRecord
): Promise<ReviewRecord> {
  const review: ReviewRecord = {
    caseId,
    submissionPath,
    escalatedAt: new Date().toISOString(),
    criteria: outcomes.map((outcome) => ({
      id: outcome.id,
      verdict: outcome.result,
      reason: outcome.reason ?? reasonFor(outcome),
      evidence: outcome.evidence
    })),
    authorizationId: paymentRecord.authorizationId,
    expirationTime: paymentRecord.authorizationExpirationTime,
    status: "pending"
  };
  await fs.mkdir(path.dirname(reviewPath(caseId)), { recursive: true });
  await fs.writeFile(reviewPath(caseId), JSON.stringify(review, null, 2));
  await fs.writeFile(reviewMarkdownPath(caseId), renderReviewMarkdown(review));
  return review;
}

export function renderReviewMarkdown(review: ReviewRecord): string {
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

export async function readReview(caseId: string): Promise<ReviewRecord> {
  try {
    return JSON.parse(await fs.readFile(reviewPath(caseId), "utf8")) as ReviewRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`No pending review exists for case ${caseId}.`);
    throw new Error(`Unable to read review for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function resolveReviewHandoff(caseId: string, decision: "release" | "reject", operator = process.env.OPERATOR_NAME ?? "unknown", contractorEmail = process.env.PAYPAL_CONTRACTOR_EMAIL): Promise<ReviewRecord> {
  const review = await readReview(caseId);
  if (review.status !== "pending") throw new Error(`Review for ${caseId} is already ${review.status}.`);
  if (review.expirationTime && Date.now() >= new Date(review.expirationTime).getTime()) throw new Error(`Authorization for ${caseId} has expired.`);
  const payment = await getPaymentRecord(caseId);
  if (decision === "reject" && payment.milestones.length > 0) {
    await markNeedsReview(caseId, "Review reject requested after a capture; manual refund decision is required.");
    review.status = "needs_review";
    await fs.writeFile(reviewPath(caseId), JSON.stringify(review, null, 2));
    throw new Error("A capture already exists; review marked needs_review and no PayPal call was made.");
  }
  if (decision === "release") await releaseMilestone(caseId, payment.amount, 1, contractorEmail);
  else await rejectMilestone(caseId);
  const updated = await getPaymentRecord(caseId);
  review.status = "resolved";
  review.decision = decision;
  review.decidedAt = new Date().toISOString();
  review.operator = operator;
  review.paypalIds = {
    authorizationId: updated.authorizationId,
    captureId: updated.milestones[updated.milestones.length - 1]?.captureId,
    payoutBatchId: updated.milestones[updated.milestones.length - 1]?.payoutBatchId
  };
  await fs.writeFile(reviewPath(caseId), JSON.stringify(review, null, 2));
  await fs.writeFile(reviewMarkdownPath(caseId), renderReviewMarkdown(review));
  return review;
}

export function timeRemaining(expirationTime?: string): { milliseconds: number; text: string; warning: boolean } {
  if (!expirationTime) return { milliseconds: Number.NaN, text: "unknown", warning: false };
  const milliseconds = new Date(expirationTime).getTime() - Date.now();
  const hours = Math.max(0, Math.floor(milliseconds / 3_600_000));
  const minutes = Math.max(0, Math.floor((milliseconds % 3_600_000) / 60_000));
  return { milliseconds, text: `${hours}h ${minutes}m`, warning: milliseconds < 24 * 3_600_000 };
}
