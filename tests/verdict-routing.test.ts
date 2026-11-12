import { judgeCriterion } from "../src/judge";
import { route, type CriterionOutcome } from "../src/route";

const callWith = (values: string[]) => {
  let index = 0;
  return async () => values[index++];
};

const verdictJson = (verdict: "pass" | "fail" | "unclear", reason = "Evaluated criterion", files = ["src/app.ts"]) =>
  JSON.stringify({ verdict, reason, files });

describe("Three outputs: verdict logic and routing", () => {
  const dummyCriterion = { id: "C1", criterion: "The application uses Node 20 and Express." };
  const submissionDir = "testset/cases/c01/reference";

  test("returns pass from 3 agreeing model responses, routing to release", async () => {
    const judgeCall = callWith([
      verdictJson("pass", "All checks passed"),
      verdictJson("pass", "All checks passed"),
      verdictJson("pass", "All checks passed")
    ]);

    const judged = await judgeCriterion(dummyCriterion, submissionDir, judgeCall);
    expect(judged.combined).toBe("decided");
    expect(judged.result).toBe("pass");

    const outcomes: CriterionOutcome[] = [
      { id: dummyCriterion.id, method: "code_review", result: judged.result, evidence: judged }
    ];
    const decision = route(outcomes);
    expect(decision.decision).toBe("release");
    expect(decision.failingCriteria).toHaveLength(0);
  });

  test("returns fail from 3 agreeing model responses, routing to reject", async () => {
    const judgeCall = callWith([
      verdictJson("fail", "Requirement violated"),
      verdictJson("fail", "Requirement violated"),
      verdictJson("fail", "Requirement violated")
    ]);

    const judged = await judgeCriterion(dummyCriterion, submissionDir, judgeCall);
    expect(judged.combined).toBe("decided");
    expect(judged.result).toBe("fail");

    const outcomes: CriterionOutcome[] = [
      { id: dummyCriterion.id, method: "code_review", result: judged.result, evidence: judged }
    ];
    const decision = route(outcomes);
    expect(decision.decision).toBe("reject");
    expect(decision.failingCriteria).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "C1", result: "fail" })])
    );
  });

  test("returns unclear when models disagree, routing to escalate", async () => {
    const judgeCall = callWith([
      verdictJson("pass", "Looks acceptable"),
      verdictJson("pass", "Looks acceptable"),
      verdictJson("fail", "Disagrees on implementation")
    ]);

    const judged = await judgeCriterion(dummyCriterion, submissionDir, judgeCall);
    expect(judged.combined).toBe("unclear");
    expect(judged.result).toBe("unclear");

    const outcomes: CriterionOutcome[] = [
      { id: dummyCriterion.id, method: "code_review", result: judged.result, evidence: judged }
    ];
    const decision = route(outcomes);
    expect(decision.decision).toBe("escalate");
  });

  test("returns unclear when models return unclear, routing to escalate", async () => {
    const judgeCall = callWith([
      verdictJson("unclear", "Insufficient evidence"),
      verdictJson("unclear", "Insufficient evidence"),
      verdictJson("unclear", "Insufficient evidence")
    ]);

    const judged = await judgeCriterion(dummyCriterion, submissionDir, judgeCall);
    expect(judged.combined).toBe("decided");
    expect(judged.result).toBe("unclear");

    const outcomes: CriterionOutcome[] = [
      { id: dummyCriterion.id, method: "code_review", result: judged.result, evidence: judged }
    ];
    const decision = route(outcomes);
    expect(decision.decision).toBe("escalate");
  });
});
