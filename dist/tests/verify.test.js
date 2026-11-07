"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const verify_1 = require("../src/verify");
const criteria = JSON.stringify({ summary: "orders", criteria: [{ id: "C1", criterion: "creates orders", method: "test", status: "ready", source: "brief" }, { id: "C2", criterion: "rejects negatives", method: "test", status: "ready", source: "brief" }, { id: "C3", criterion: "Reject only negative quantities, not zero quantities", method: "code_review", status: "ready", source: "brief" }], open_questions: [], out_of_scope: [] });
test("releases reference and rejects subtle bug", async () => {
    await promises_1.default.rm(node_path_1.default.resolve("out", "c01"), { recursive: true, force: true });
    await promises_1.default.rm(node_path_1.default.resolve("out", "c01-reject"), { recursive: true, force: true });
    await promises_1.default.mkdir(node_path_1.default.resolve("out", "c01"), { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.resolve("out", "c01", "criteria.json"), JSON.stringify({
        caseId: "c01", summary: "orders", criteria: JSON.parse(criteria).criteria,
        open_questions: [], out_of_scope: [], status: "approved",
        proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
    }));
    await promises_1.default.mkdir(node_path_1.default.resolve("out", "c01-reject"), { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.resolve("out", "c01-reject", "criteria.json"), JSON.stringify({
        caseId: "c01-reject", summary: "orders", criteria: JSON.parse(criteria).criteria,
        open_questions: [], out_of_scope: [], status: "approved",
        proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
    }));
    const criteriaCall = async () => criteria;
    const judgeCall = async (prompt) => JSON.stringify({
        verdict: prompt.includes("quantity<=0") ? "fail" : "pass",
        reason: "The quantity boundary is implemented in the source.",
        files: ["src/app.ts"]
    });
    await expect((0, verify_1.verify)("testset/cases/c01", "testset/cases/c01/reference", { criteriaCall, judgeCall })).resolves.toMatchObject({ decision: "release" });
    await expect((0, verify_1.verify)("testset/cases/c01", "testset/cases/c01/variants/V2_subtle_bug", { criteriaCall, judgeCall, paymentCaseId: "c01-reject" })).resolves.toMatchObject({ decision: "reject" });
});
test("refuses verification without approved criteria", async () => {
    await promises_1.default.rm(node_path_1.default.resolve("out", "c02"), { recursive: true, force: true });
    await expect((0, verify_1.verify)("testset/cases/c02", "testset/cases/c01/reference")).rejects.toThrow("No criteria file exists");
});
test("writes an escalation handoff when criteria are uncertain", async () => {
    const caseId = "c03";
    await promises_1.default.rm(node_path_1.default.resolve("out", caseId), { recursive: true, force: true });
    await promises_1.default.mkdir(node_path_1.default.resolve("out", caseId), { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.resolve("out", caseId, "criteria.json"), JSON.stringify({
        caseId, summary: "manual delivery", criteria: [{ id: "C1", criterion: "manual review", method: "manual", status: "needs_clarification", source: "brief" }],
        open_questions: [], out_of_scope: [], status: "approved",
        proposedAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: "test"
    }));
    await expect((0, verify_1.verify)("testset/cases/c03", "testset/cases/c01/reference")).resolves.toMatchObject({ decision: "escalate" });
    const review = JSON.parse(await promises_1.default.readFile(node_path_1.default.resolve("out", caseId, "review.json"), "utf8"));
    expect(review).toMatchObject({ caseId, status: "pending", criteria: [{ id: "C1", verdict: "unclear" }] });
    await expect(promises_1.default.readFile(node_path_1.default.resolve("out", caseId, "review.md"), "utf8")).resolves.toContain("# Human review: c03");
});
