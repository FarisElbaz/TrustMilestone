"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("../src/milestone");
const caseId = "guard-test";
let tempDir;
let file;
beforeAll(async () => {
    tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "milestone-guards-test-"));
    process.env.OUTPUT_ROOT = tempDir;
    file = node_path_1.default.resolve(tempDir, caseId, "paypal.json");
});
afterAll(async () => {
    await promises_1.default.rm(tempDir, { recursive: true, force: true });
});
async function seed(extra = {}) {
    await promises_1.default.mkdir(node_path_1.default.dirname(file), { recursive: true });
    await promises_1.default.writeFile(file, JSON.stringify({
        caseId, amount: "10.00", currency: "USD", createdAt: new Date().toISOString(),
        authorizationId: "auth-1", authorizedAt: new Date().toISOString(),
        authorizationStatus: "AUTHORIZED", milestones: [], ...extra
    }));
}
beforeEach(async () => { process.env.PAYMENT_MODE = "mock"; await seed(); });
afterEach(async () => { await promises_1.default.rm(node_path_1.default.resolve(tempDir, caseId), { recursive: true, force: true }); });
test("refuses duplicate milestone", async () => {
    await (0, milestone_1.releaseMilestone)(caseId, "1.00");
    await expect((0, milestone_1.releaseMilestone)(caseId, "1.00")).rejects.toThrow("already been recorded");
});
test("refuses cumulative amount over authorization", async () => {
    await (0, milestone_1.releaseMilestone)(caseId, "6.00");
    await expect((0, milestone_1.releaseMilestone)(caseId, "5.00", 2)).rejects.toThrow("exceeds");
});
test("refuses void after capture", async () => {
    await (0, milestone_1.releaseMilestone)(caseId, "1.00");
    await expect((0, milestone_1.rejectMilestone)(caseId)).rejects.toThrow("after capture");
});
test("refuses voided authorization", async () => {
    await seed({ authorizationStatus: "VOIDED" });
    await expect((0, milestone_1.releaseMilestone)(caseId, "1.00")).rejects.toThrow("was voided");
});
test("refuses expired authorization", async () => {
    await seed({ authorizedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });
    await expect((0, milestone_1.releaseMilestone)(caseId, "1.00")).rejects.toThrow("expired");
});
