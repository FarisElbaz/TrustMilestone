export type CriterionOutcome = { id: string; method: "test" | "code_review" | "manual"; result: "pass" | "fail" | "unclear"; evidence: unknown };
export type Decision = { decision: "release" | "reject" | "escalate"; failingCriteria: CriterionOutcome[]; evidence: unknown[] };

export function route(outcomes: CriterionOutcome[]): Decision {
  const failingCriteria = outcomes.filter((outcome) => outcome.result === "fail" && outcome.method !== "manual");
  if (failingCriteria.length > 0) return { decision: "reject", failingCriteria, evidence: failingCriteria.map((item) => item.evidence) };
  if (outcomes.some((outcome) => outcome.result === "unclear" || outcome.method === "manual")) return { decision: "escalate", failingCriteria: [], evidence: [] };
  return { decision: "release", failingCriteria: [], evidence: [] };
}
