"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.route = route;
function route(outcomes) {
    const failingCriteria = outcomes.filter((outcome) => outcome.result === "fail" && outcome.method !== "manual");
    if (failingCriteria.length > 0)
        return { decision: "reject", failingCriteria, evidence: failingCriteria.map((item) => item.evidence) };
    if (outcomes.some((outcome) => outcome.result === "unclear" || outcome.method === "manual"))
        return { decision: "escalate", failingCriteria: [], evidence: [] };
    return { decision: "release", failingCriteria: [], evidence: [] };
}
