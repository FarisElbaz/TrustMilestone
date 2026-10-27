import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config";
import { generateCriteria, ModelCall } from "./criteria";
import { runTests } from "./sandbox";
import { judgeCriterion, JudgeModelCall } from "./judge";
import { route, CriterionOutcome, Decision } from "./route";
import { milestone } from "./milestone";

export interface VerifyOptions { criteriaCall?: ModelCall; judgeCall?: JudgeModelCall; }
export async function verify(caseDir: string, submissionDir: string, options: VerifyOptions = {}): Promise<Decision> {
  const caseId = path.basename(caseDir);
  const manifest = JSON.parse(await fs.readFile(path.join(caseDir, "manifest.json"), "utf8")) as { stack?: string };
  const brief = await fs.readFile(path.join(caseDir, "brief.md"), "utf8");
  const criteria = await generateCriteria(brief, manifest.stack ?? "Node 20", options.criteriaCall);
  const config = loadConfig();
  const metadata = { caseId, submissionPath: path.resolve(submissionDir), timestamp: new Date().toISOString(), models: { criteria_generator: config.criteria_generator.model, code_review_judge: config.code_review_judge.model } };
  const outDir = path.resolve("out", caseId);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "criteria.json"), JSON.stringify({ ...metadata, ...criteria }, null, 2));
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
  if (decision.decision === "release") await milestone.releaseMilestone(caseId, decision);
  else await milestone.holdMilestone(caseId, decision);
  return decision;
}
