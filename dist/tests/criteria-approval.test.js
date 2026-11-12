"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const criteria_approval_1 = require("../src/criteria-approval");
const caseId = "criteria-test";
let tempDir;
let output;
beforeAll(async () => {
    tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "criteria-approval-test-"));
    process.env.OUTPUT_ROOT = tempDir;
    output = node_path_1.default.resolve(tempDir, caseId);
});
afterAll(async () => {
    await promises_1.default.rm(tempDir, { recursive: true, force: true });
});
const generated = JSON.stringify({
    summary: "validated delivery",
    criteria: [{ id: "C1", criterion: "the work is complete", method: "test", status: "ready", source: "brief" }],
    open_questions: [{ question: "Which output format?", affects: ["delivery"] }],
    out_of_scope: []
});
const call = async (prompt) => prompt.includes("revision") ? generated.replace("the work is complete", "the revised work is complete") : generated;
beforeEach(async () => { await promises_1.default.rm(output, { recursive: true, force: true }); });
test("approves proposed criteria", async () => {
    const result = await (0, criteria_approval_1.generateAndApproveCriteria)(caseId, "brief", "Node 20", async () => "approve", call);
    expect(result?.status).toBe("approved");
    expect(result?.approvedBy).toBe(process.env.OPERATOR_NAME ?? "unknown");
});
test("revises then approves criteria", async () => {
    const answers = ["revise", "the revision", "approve"];
    const result = await (0, criteria_approval_1.generateAndApproveCriteria)(caseId, "brief", "Node 20", async () => answers.shift() ?? "approve", call);
    expect(result?.criteria[0].criterion).toBe("the revised work is complete");
});
test("cancels criteria approval", async () => {
    const result = await (0, criteria_approval_1.generateAndApproveCriteria)(caseId, "brief", "Node 20", async () => "cancel", call);
    expect(result).toBeUndefined();
    await expect((0, criteria_approval_1.readStoredCriteria)(caseId)).resolves.toMatchObject({ status: "cancelled" });
});
test("regeneration invalidates approval", async () => {
    await (0, criteria_approval_1.proposeCriteria)(caseId, "brief", "Node 20", call);
    await (0, criteria_approval_1.approveStoredCriteria)(caseId);
    await (0, criteria_approval_1.invalidateCriteria)(caseId);
    const invalidated = await (0, criteria_approval_1.readStoredCriteria)(caseId);
    expect(invalidated.status).toBe("proposed");
    expect(invalidated).not.toHaveProperty("approvedAt");
});
