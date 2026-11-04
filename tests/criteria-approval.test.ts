import fs from "node:fs/promises";
import path from "node:path";
import { approveStoredCriteria, generateAndApproveCriteria, invalidateCriteria, proposeCriteria, readStoredCriteria } from "../src/criteria-approval";

const caseId = "criteria-test";
const output = path.resolve("out", caseId);
const generated = JSON.stringify({
  summary: "validated delivery",
  criteria: [{ id: "C1", criterion: "the work is complete", method: "test", status: "ready", source: "brief" }],
  open_questions: [{ question: "Which output format?", affects: ["delivery"] }],
  out_of_scope: []
});
const call = async (prompt: string) => prompt.includes("revision") ? generated.replace("the work is complete", "the revised work is complete") : generated;

beforeEach(async () => { await fs.rm(output, { recursive: true, force: true }); });
afterAll(async () => { await fs.rm(output, { recursive: true, force: true }); });

test("approves proposed criteria", async () => {
  const result = await generateAndApproveCriteria(caseId, "brief", "Node 20", async () => "approve", call);
  expect(result?.status).toBe("approved");
  expect(result?.approvedBy).toBe(process.env.OPERATOR_NAME ?? "unknown");
});

test("revises then approves criteria", async () => {
  const answers = ["revise", "the revision", "approve"];
  const result = await generateAndApproveCriteria(caseId, "brief", "Node 20", async () => answers.shift() ?? "approve", call);
  expect(result?.criteria[0].criterion).toBe("the revised work is complete");
});

test("cancels criteria approval", async () => {
  const result = await generateAndApproveCriteria(caseId, "brief", "Node 20", async () => "cancel", call);
  expect(result).toBeUndefined();
  await expect(readStoredCriteria(caseId)).resolves.toMatchObject({ status: "cancelled" });
});

test("regeneration invalidates approval", async () => {
  await proposeCriteria(caseId, "brief", "Node 20", call);
  await approveStoredCriteria(caseId);
  await invalidateCriteria(caseId);
  const invalidated = await readStoredCriteria(caseId);
  expect(invalidated.status).toBe("proposed");
  expect(invalidated).not.toHaveProperty("approvedAt");
});
