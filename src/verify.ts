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
import { outputRoot } from "./paths";

export interface VerifyOptions { criteriaCall?: ModelCall; judgeCall?: JudgeModelCall; amount?: string; currency?: string; paymentCaseId?: string; buyerEmail?: string; contractorEmail?: string; }

interface ManifestRequirement {
  id: string;
  text: string;
}

interface TestMatchRecord {
  type: "requirement" | "test_name";
  requirementId?: string;
  manifestText?: string;
  matchedTests: string[];
}

function criterionTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function mapCriterionToTests(
  criterion: { id: string; criterion: string; source?: string; requirementId?: string },
  manifestRequirements: ManifestRequirement[],
  results: { name: string; status: "passed" | "failed" | "unknown"; failureMessage?: string; requirementId?: string }[]
): { matching: typeof results; matchRecord: TestMatchRecord } {
  // 1. Check if criterion has a requirement ID directly (REQ-n)
  let reqId: string | undefined =
    criterion.requirementId ??
    criterion.id.match(/^REQ-\d+$/i)?.[0]?.toUpperCase() ??
    criterion.source?.match(/REQ-\d+/i)?.[0]?.toUpperCase() ??
    criterion.criterion.match(/REQ-\d+/i)?.[0]?.toUpperCase();

  // If not directly specified, match through the case manifest's requirement list
  let matchedManifestReq: ManifestRequirement | undefined;
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

export async function verify(caseDir: string, submissionDir: string, options: VerifyOptions = {}): Promise<Decision> {
  const caseId = path.basename(caseDir);
  validatePaymentEnvironment();
  const manifest = JSON.parse(await fs.readFile(path.join(caseDir, "manifest.json"), "utf8")) as { stack?: string };
  const criteria = await readStoredCriteria(caseId);
  if (criteria.status !== "approved") throw new Error(`Criteria for case ${caseId} must be approved before verification (status: ${criteria.status}).`);
  const config = loadConfig();
  const metadata = { caseId, submissionPath: path.resolve(submissionDir), timestamp: new Date().toISOString(), models: { criteria_generator: config.criteria_generator.model, code_review_judge: config.code_review_judge.model } };
  const outDir = path.resolve(outputRoot(), caseId);
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
    const manifestRequirements: ManifestRequirement[] = (manifest as { requirements?: ManifestRequirement[] }).requirements ?? [];

    let results: Awaited<ReturnType<typeof runTests>> = [];
    let runnerError: string | undefined;
    try {
      results = await runTests(submissionDir, testDir);
    } catch (error) {
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
    } else {
      // Ensure test results have requirementId resolved if missing
      try {
        const testFiles = await fs.readdir(testDir);
        const source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => fs.readFile(path.join(testDir, f), "utf8")))).join("\n");
        for (const r of results) {
          if (!r.requirementId) {
            const escaped = r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = new RegExp(`(?:test|it)\\s*\\(\\s*["'\`]` + escaped + `["'\`]`, "i");
            const match = pattern.exec(source);
            const snippet = match ? source.slice(match.index, match.index + 1000) : source;
            const req = snippet.match(/\/\/\s*(REQ-\d+)/i)?.[1]?.toUpperCase();
            if (req) r.requirementId = req;
          }
        }
      } catch {}

      for (const criterion of testCriteria) {
        const { matching, matchRecord } = mapCriterionToTests(criterion, manifestRequirements, results);
        const hasFailed = matching.some((result) => result.status === "failed");
        const allPassed = matching.length > 0 && matching.every((result) => result.status === "passed");
        const result: "pass" | "fail" | "unclear" = hasFailed ? "fail" : allPassed ? "pass" : "fail";
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
