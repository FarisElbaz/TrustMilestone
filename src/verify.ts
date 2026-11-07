import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { ModelCall } from "./criteria";
import { readStoredCriteria } from "./criteria-approval";
import { runTests } from "./sandbox";
import { judgeCriterion, JudgeModelCall } from "./judge";
import { route, CriterionOutcome, Decision } from "./route";
import { fundCase, getPaymentRecord, holdMilestone, rejectMilestone, releaseMilestone, paymentStatus } from "./milestone";
import { writeEscalationReview } from "./review-handoff";
import { validatePaymentEnvironment } from "./paypal/config";

export interface VerifyOptions { criteriaCall?: ModelCall; judgeCall?: JudgeModelCall; amount?: string; currency?: string; paymentCaseId?: string; buyerEmail?: string; contractorEmail?: string; }
export async function verify(caseDir: string, submissionDir: string, options: VerifyOptions = {}): Promise<Decision> {
  const caseId = path.basename(caseDir);
  validatePaymentEnvironment();
  const manifest = JSON.parse(await fs.readFile(path.join(caseDir, "manifest.json"), "utf8")) as { stack?: string };
  const criteria = await readStoredCriteria(caseId);
  if (criteria.status !== "approved") throw new Error(`Criteria for case ${caseId} must be approved before verification (status: ${criteria.status}).`);
  const config = loadConfig();
  const metadata = { caseId, submissionPath: path.resolve(submissionDir), timestamp: new Date().toISOString(), models: { criteria_generator: config.criteria_generator.model, code_review_judge: config.code_review_judge.model } };
  const outDir = path.resolve("out", caseId);
  await fs.mkdir(outDir, { recursive: true });
  if (options.currency) process.env.PAYPAL_CURRENCY = options.currency;
  const amount = options.amount ?? process.env.PAYPAL_AMOUNT ?? "10.00";
  const paymentCaseId = options.paymentCaseId ?? caseId;
  if ((process.env.PAYMENT_MODE ?? "mock") === "mock") await fundCase(paymentCaseId, amount, options.currency);
  else await paymentStatus(paymentCaseId, options.buyerEmail);
  const outcomes: CriterionOutcome[] = [];
  const testCriteria = criteria.criteria.filter((criterion) => criterion.method === "test");
  if (testCriteria.length > 0) {
    const declaredTests = path.join(caseDir, "tests");
    const testDir = await fs.access(declaredTests).then(() => declaredTests).catch(() => path.join(caseDir, "reference", "tests"));
    const results = await runTests(submissionDir, testDir);
    for (const criterion of testCriteria) {
      const matching = results.filter((result) => result.requirementId === criterion.id || result.requirementId === criterion.id.replace("C", "REQ-"));
      outcomes.push({ id: criterion.id, method: "test", result: matching.some((result) => result.status === "failed") ? "fail" : matching.length ? "pass" : "unclear", evidence: matching });
    }
  }
  for (const criterion of criteria.criteria.filter((item) => item.method === "code_review")) {
    const judged = await judgeCriterion(criterion, submissionDir, options.judgeCall);
    outcomes.push({ id: criterion.id, method: "code_review", result: judged.combined === "decided" ? judged.result : "unclear", evidence: judged });
  }
  for (const criterion of criteria.criteria.filter((item) => item.method === "manual")) outcomes.push({ id: criterion.id, method: "manual", result: "unclear", evidence: "manual review required" });
  const decision = route(outcomes);
  await fs.writeFile(path.join(outDir, "result.json"), JSON.stringify({ ...metadata, ...decision, outcomes }, null, 2));
  if (decision.decision === "release") await releaseMilestone(paymentCaseId, amount, 1, options.contractorEmail);
  else if (decision.decision === "reject") await rejectMilestone(paymentCaseId);
  else {
    await holdMilestone(paymentCaseId, new Date(Date.now() + 24 * 60 * 60 * 1000));
    await writeEscalationReview(caseId, path.resolve(submissionDir), outcomes, await getPaymentRecord(paymentCaseId));
  }
  return decision;
}
