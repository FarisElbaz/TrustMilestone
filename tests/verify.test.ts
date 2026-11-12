import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verify } from "../src/verify";

let tempDir: string;
const caseOut = (caseId: string) => path.join(tempDir, caseId);

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-test-"));
  process.env.OUTPUT_ROOT = tempDir;
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const criteria = JSON.stringify({ summary: "orders", criteria: [{ id: "C1", criterion: "creates orders", method: "test", status: "ready", source: "brief" }, { id: "C2", criterion: "rejects negatives", method: "test", status: "ready", source: "brief" }, { id: "C3", criterion: "Reject only negative quantities, not zero quantities", method: "code_review", status: "ready", source: "brief" }], open_questions: [], out_of_scope: [] });
test("releases reference and rejects subtle bug", async () => {
  await fs.rm(caseOut("c01"), { recursive: true, force: true });
  await fs.rm(caseOut("c01-reject"), { recursive: true, force: true });
  await fs.mkdir(caseOut("c01"), { recursive: true });
  await fs.writeFile(path.join(caseOut("c01"), "criteria.json"), JSON.stringify({
    caseId: "c01", summary: "orders", criteria: JSON.parse(criteria).criteria,
    open_questions: [], out_of_scope: [], status: "approved",
    proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
  }));
  await fs.mkdir(caseOut("c01-reject"), { recursive: true });
  await fs.writeFile(path.join(caseOut("c01-reject"), "criteria.json"), JSON.stringify({
    caseId: "c01-reject", summary: "orders", criteria: JSON.parse(criteria).criteria,
    open_questions: [], out_of_scope: [], status: "approved",
    proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
  }));
  const criteriaCall = async () => criteria;
  const judgeCall = async (prompt: string) => JSON.stringify({
    verdict: prompt.includes("quantity<=0") ? "fail" : "pass",
    reason: "The quantity boundary is implemented in the source.",
    files: ["src/app.ts"]
  });
  await expect(verify("testset/cases/c01", "testset/cases/c01/reference", { criteriaCall, judgeCall })).resolves.toMatchObject({ decision: "release" });
  await expect(verify("testset/cases/c01", "testset/cases/c01/variants/V2_subtle_bug", { criteriaCall, judgeCall, paymentCaseId: "c01-reject" })).resolves.toMatchObject({ decision: "reject" });
});

test("refuses verification without approved criteria", async () => {
  await fs.rm(caseOut("c02"), { recursive: true, force: true });
  await expect(verify("testset/cases/c02", "testset/cases/c01/reference")).rejects.toThrow("No criteria file exists");
});

test("writes an escalation handoff when criteria are uncertain", async () => {
  const caseId = "c03";
  await fs.rm(caseOut(caseId), { recursive: true, force: true });
  await fs.mkdir(caseOut(caseId), { recursive: true });
  await fs.writeFile(path.join(caseOut(caseId), "criteria.json"), JSON.stringify({
    caseId, summary: "manual delivery", criteria: [{ id: "C1", criterion: "manual review", method: "manual", status: "needs_clarification", source: "brief" }],
    open_questions: [], out_of_scope: [], status: "approved",
    proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
  }));
  await expect(verify("testset/cases/c03", "testset/cases/c01/reference")).resolves.toMatchObject({ decision: "escalate" });
  const review = JSON.parse(await fs.readFile(path.join(caseOut(caseId), "review.json"), "utf8"));
  expect(review).toMatchObject({ caseId, status: "pending", criteria: [{ id: "C1", verdict: "unclear" }] });
  await expect(fs.readFile(path.join(caseOut(caseId), "review.md"), "utf8")).resolves.toContain("# Human review: c03");
});
