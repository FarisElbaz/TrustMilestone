import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUiServer } from "../src/ui-server";

let tempDir: string;
const caseOut = (caseId: string) => path.join(tempDir, caseId);

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-server-test-"));
  process.env.OUTPUT_ROOT = tempDir;
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

jest.mock("../src/criteria-approval", () => ({
  approveStoredCriteria: jest.fn(async () => ({ caseId: "ui-case", status: "approved", criteria: [], open_questions: [], out_of_scope: [] })),
  proposeCriteria: jest.fn(async () => ({ caseId: "ui-case", status: "proposed", criteria: [], open_questions: [], out_of_scope: [] })),
  readStoredCriteria: jest.fn(async () => ({ caseId: "ui-case", status: "proposed", criteria: [], open_questions: [], out_of_scope: [] }))
}));
jest.mock("../src/milestone", () => ({
  fundCase: jest.fn(async (caseId: string, amount: string, currency: string) => ({ caseId, amount, currency, milestones: [], orderId: "order-ui" })),
  paymentStatus: jest.fn(async () => ({ caseId: "ui-case", milestones: [], authorizationId: "auth-ui" })),
  refreshPayoutStatus: jest.fn(async () => "SUCCESS"),
  getPaymentRecord: jest.fn(async () => ({ caseId: "ui-case", amount: "10.00", currency: "USD", milestones: [], authorizationId: "auth-ui" }))
}));
jest.mock("../src/verify", () => ({ verify: jest.fn(async () => ({ decision: "release", failingCriteria: [], evidence: [] })) }));
jest.mock("../src/review-handoff", () => ({
  readReview: jest.fn(async () => ({ caseId: "ui-case", status: "pending", expirationTime: new Date(Date.now() - 1000).toISOString() })),
  resolveReviewHandoff: jest.fn(async () => ({ caseId: "ui-case", status: "resolved", decision: "release" })),
  timeRemaining: jest.fn(() => ({ milliseconds: -1000, text: "0h 0m", warning: true })),
  reviewMarkdownPath: (caseId: string) => path.resolve(process.env.OUTPUT_ROOT ?? "out", caseId, "review.md")
}));

const criteriaModule = jest.requireMock("../src/criteria-approval") as { readStoredCriteria: jest.Mock };
const reviewModule = jest.requireMock("../src/review-handoff") as { resolveReviewHandoff: jest.Mock };

async function start() {
  process.env.PAYPAL_ENV = "sandbox";
  const server = createUiServer({ listen: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function request(base: string, pathname: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${pathname}`, init);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

afterEach(async () => {
  jest.clearAllMocks();
  await fs.rm(caseOut("ui-case"), { recursive: true, force: true });
});

test("creates a case and rejects a duplicate ID", async () => {
  const { server, base } = await start();
  try {
    const body = JSON.stringify({ brief: "Build a widget", stack: "Node 20" });
    await expect(request(base, "/api/cases/ui-case/create", { method: "POST", body, headers: { "content-type": "application/json" } })).resolves.toMatchObject({ status: 201 });
    await expect(request(base, "/api/cases/ui-case/create", { method: "POST", body, headers: { "content-type": "application/json" } })).resolves.toMatchObject({ status: 400, body: { error: "Case ui-case already exists." } });
  } finally { server.close(); }
});

test("gates funding until criteria are approved", async () => {
  const { server, base } = await start();
  try {
    const result = await request(base, "/api/cases/ui-case/fund", { method: "POST", body: JSON.stringify({ amount: "10.00", currency: "USD" }), headers: { "content-type": "application/json" } });
    expect(result).toMatchObject({ status: 400, body: { error: "Approve criteria before creating a buyer order." } });
    criteriaModule.readStoredCriteria.mockResolvedValue({ caseId: "ui-case", status: "approved", criteria: [], open_questions: [], out_of_scope: [] });
    await expect(request(base, "/api/cases/ui-case/fund", { method: "POST", body: JSON.stringify({ amount: "10.00", currency: "USD" }), headers: { "content-type": "application/json" } })).resolves.toMatchObject({ status: 200 });
  } finally { server.close(); }
});

test("generates criteria without requiring an empty JSON request body", async () => {
  const { server, base } = await start();
  try {
    await fs.mkdir(caseOut("ui-case"), { recursive: true });
    await fs.writeFile(path.join(caseOut("ui-case"), "brief.md"), "Build a widget");
    await fs.writeFile(path.join(caseOut("ui-case"), "manifest.json"), JSON.stringify({ stack: "Node 20" }));
    const result = await request(base, "/api/cases/ui-case/criteria", { method: "POST" });
    expect(result).toMatchObject({ status: 200, body: { status: "proposed" } });
  } finally { server.close(); }
});

test("approves criteria from the UI approval route", async () => {
  const { server, base } = await start();
  try {
    const result = await request(base, "/api/cases/ui-case/approve", { method: "POST" });
    expect(result).toMatchObject({ status: 200, body: { status: "approved" } });
  } finally { server.close(); }
});

test("rejects upload path traversal", async () => {
  const { server, base } = await start();
  try {
    const boundary = "ui-boundary";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="../escape.txt"\r\nContent-Type: text/plain\r\n\r\nnope\r\n--${boundary}--\r\n`;
    const result = await request(base, "/api/cases/ui-case/upload", { method: "POST", body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    expect(result).toMatchObject({ status: 400, body: { error: "Upload contains a path traversal." } });
  } finally { server.close(); }
});

test("refuses verification without an uploaded submission", async () => {
  const { server, base } = await start();
  try {
    criteriaModule.readStoredCriteria.mockResolvedValue({ caseId: "ui-case", status: "approved", criteria: [], open_questions: [], out_of_scope: [] });
    const result = await request(base, "/api/cases/ui-case/verify", { method: "POST" });
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain("submission");
  } finally { server.close(); }
});

test("refuses expired review resolution", async () => {
  reviewModule.resolveReviewHandoff.mockRejectedValue(new Error("Authorization for ui-case has expired."));
  const { server, base } = await start();
  try {
    const result = await request(base, "/api/cases/ui-case/review", { method: "POST", body: JSON.stringify({ decision: "release" }), headers: { "content-type": "application/json" } });
    expect(result).toMatchObject({ status: 400, body: { error: "Authorization for ui-case has expired." } });
  } finally { server.close(); }
});
