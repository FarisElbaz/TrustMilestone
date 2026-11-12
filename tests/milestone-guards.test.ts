import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { releaseMilestone, rejectMilestone } from "../src/milestone";

const caseId = "guard-test";
let tempDir: string;
let file: string;

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "milestone-guards-test-"));
  process.env.OUTPUT_ROOT = tempDir;
  file = path.resolve(tempDir, caseId, "paypal.json");
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function seed(extra: Record<string, unknown> = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    caseId, amount: "10.00", currency: "USD", createdAt: new Date().toISOString(),
    authorizationId: "auth-1", authorizedAt: new Date().toISOString(),
    authorizationStatus: "AUTHORIZED", milestones: [], ...extra
  }));
}
beforeEach(async () => { process.env.PAYMENT_MODE = "mock"; await seed(); });
afterEach(async () => { await fs.rm(path.resolve(tempDir, caseId), { recursive: true, force: true }); });

test("refuses duplicate milestone", async () => {
  await releaseMilestone(caseId, "1.00");
  await expect(releaseMilestone(caseId, "1.00")).rejects.toThrow("already been recorded");
});
test("refuses cumulative amount over authorization", async () => {
  await releaseMilestone(caseId, "6.00");
  await expect(releaseMilestone(caseId, "5.00", 2)).rejects.toThrow("exceeds");
});
test("refuses void after capture", async () => {
  await releaseMilestone(caseId, "1.00");
  await expect(rejectMilestone(caseId)).rejects.toThrow("after capture");
});
test("refuses voided authorization", async () => {
  await seed({ authorizationStatus: "VOIDED" });
  await expect(releaseMilestone(caseId, "1.00")).rejects.toThrow("was voided");
});
test("refuses expired authorization", async () => {
  await seed({ authorizedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() });
  await expect(releaseMilestone(caseId, "1.00")).rejects.toThrow("expired");
});
