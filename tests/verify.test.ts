import { verify } from "../src/verify";
const criteria = JSON.stringify({ summary: "orders", criteria: [{ id: "C1", criterion: "creates orders", method: "test", status: "ready", source: "brief" }, { id: "C2", criterion: "rejects negatives", method: "test", status: "ready", source: "brief" }, { id: "C3", criterion: "Reject only negative quantities, not zero quantities", method: "code_review", status: "ready", source: "brief" }], open_questions: [], out_of_scope: [] });
test("releases reference and rejects subtle bug", async () => {
  const criteriaCall = async () => criteria;
  const judgeCall = async (prompt: string) => JSON.stringify({
    verdict: prompt.includes("quantity<=0") ? "fail" : "pass",
    reason: "The quantity boundary is implemented in the source.",
    files: ["src/app.ts"]
  });
  await expect(verify("testset/cases/c01", "testset/cases/c01/reference", { criteriaCall, judgeCall })).resolves.toMatchObject({ decision: "release" });
  await expect(verify("testset/cases/c01", "testset/cases/c01/variants/V2_subtle_bug", { criteriaCall, judgeCall })).resolves.toMatchObject({ decision: "reject" });
});
