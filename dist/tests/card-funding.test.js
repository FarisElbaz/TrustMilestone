"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("../src/milestone");
const evidence_1 = require("../src/paypal/evidence");
const client_1 = require("../src/paypal/client");
const originalEnv = { ...process.env };
let tempDir;
const caseOut = (caseId) => node_path_1.default.join(tempDir, caseId);
beforeAll(async () => {
    tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "card-funding-test-"));
});
afterAll(async () => {
    await promises_1.default.rm(tempDir, { recursive: true, force: true });
});
beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OUTPUT_ROOT = tempDir;
    process.env.PAYPAL_ENV = "sandbox";
    process.env.PAYPAL_CURRENCY = "USD";
    process.env.PAYPAL_CLIENT_ID = "test-client-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
    process.env.PAYPAL_BUYER_EMAIL = "buyer@sandbox.test";
    process.env.PAYPAL_CONTRACTOR_EMAIL = "contractor@sandbox.test";
    (0, client_1.resetPayPalTokenCache)();
});
afterEach(async () => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
});
test("card funding builds the correct request", async () => {
    const caseId = "test-build-req";
    process.env.PAYMENT_MODE = "sandbox";
    process.env.PAYPAL_TEST_CARD_NUMBER = "4111111111111111";
    process.env.PAYPAL_TEST_CARD_EXPIRY = "2028-12";
    process.env.PAYPAL_TEST_CARD_SECURITY_CODE = "123";
    process.env.PAYPAL_TEST_CARD_NAME = "Test Buyer";
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "criteria.json"), JSON.stringify({
        caseId, status: "approved", proposedAt: new Date().toISOString(), criteria: []
    }));
    const calls = [];
    jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
        calls.push({ url: String(input), init });
        if (calls.length === 1) {
            return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), {
                status: 200, headers: { "content-type": "application/json" }
            });
        }
        if (calls.length === 2) {
            return new Response(JSON.stringify({
                id: "order-card-123",
                status: "COMPLETED",
                links: []
            }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (calls.length === 3) {
            return new Response(JSON.stringify({
                id: "order-card-123",
                status: "COMPLETED",
                purchase_units: [{ payments: { authorizations: [{ id: "auth-card-456" }] } }]
            }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
            id: "auth-card-456",
            status: "CREATED",
            amount: { currency_code: "USD", value: "10.00" },
            expiration_time: "2028-12-01T00:00:00Z"
        }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const record = await (0, milestone_1.fundCase)(caseId, "10.00", "USD", "card");
    expect(record.orderId).toBe("order-card-123");
    expect(record.authorizationId).toBe("auth-card-456");
    expect(record.authorizationExpirationTime).toBe("2028-12-01T00:00:00Z");
    const createReq = calls[1];
    expect(createReq.url).toContain("/v2/checkout/orders");
    expect(createReq.init?.headers).toHaveProperty("PayPal-Request-Id");
    const body = JSON.parse(String(createReq.init?.body));
    expect(body).toEqual({
        intent: "AUTHORIZE",
        payment_source: {
            card: {
                number: "4111111111111111",
                expiry: "2028-12",
                security_code: "123",
                name: "Test Buyer"
            }
        },
        purchase_units: [{
                reference_id: caseId,
                amount: { currency_code: "USD", value: "10.00" }
            }]
    });
    await promises_1.default.rm(outDir, { recursive: true, force: true });
});
test("missing card variables give a clear error", async () => {
    const caseId = "test-missing-card";
    process.env.PAYMENT_MODE = "sandbox";
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "criteria.json"), JSON.stringify({
        caseId, status: "approved", proposedAt: new Date().toISOString(), criteria: []
    }));
    delete process.env.PAYPAL_TEST_CARD_NUMBER;
    delete process.env.PAYPAL_TEST_CARD_EXPIRY;
    delete process.env.PAYPAL_TEST_CARD_SECURITY_CODE;
    delete process.env.PAYPAL_TEST_CARD_NAME;
    await expect((0, milestone_1.fundCase)(caseId, "10.00", "USD", "card")).rejects.toThrow(/Missing card environment variable\(s\): PAYPAL_TEST_CARD_NUMBER, PAYPAL_TEST_CARD_EXPIRY, PAYPAL_TEST_CARD_SECURITY_CODE, PAYPAL_TEST_CARD_NAME/);
    await promises_1.default.rm(outDir, { recursive: true, force: true });
});
test("the second authorization is refused", async () => {
    const caseId = "test-second-auth";
    process.env.PAYMENT_MODE = "mock";
    process.env.PAYPAL_TEST_CARD_NUMBER = "4111111111111111";
    process.env.PAYPAL_TEST_CARD_EXPIRY = "2028-12";
    process.env.PAYPAL_TEST_CARD_SECURITY_CODE = "123";
    process.env.PAYPAL_TEST_CARD_NAME = "Test Buyer";
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "criteria.json"), JSON.stringify({
        caseId, status: "approved", proposedAt: new Date().toISOString(), criteria: []
    }));
    const first = await (0, milestone_1.fundCase)(caseId, "10.00", "USD", "card");
    expect(first.authorizationId).toBeDefined();
    await expect((0, milestone_1.fundCase)(caseId, "10.00", "USD", "card")).rejects.toThrow(/already has an authorization/);
    await promises_1.default.rm(outDir, { recursive: true, force: true });
});
test("the balance check shows the not-verified message on a 403", async () => {
    const caseId = "test-balance-403";
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    let calls = 0;
    jest.spyOn(global, "fetch").mockImplementation(async () => {
        calls++;
        if (calls === 1) {
            return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), {
                status: 200, headers: { "content-type": "application/json" }
            });
        }
        return new Response(JSON.stringify({
            name: "NOT_AUTHORIZED",
            message: "Authorization failed due to insufficient permissions."
        }), { status: 403, headers: { "content-type": "application/json" } });
    });
    const result = await (0, evidence_1.checkBusinessBalance)(caseId, "USD");
    expect(result.verified).toBe(false);
    expect(result.message).toBe("Balance not verified: PayPal reporting permission not granted");
    const evidence = await (0, evidence_1.readEvidence)(caseId);
    expect(evidence.moneyChecks?.businessBalanceAfterRelease).toEqual({
        verified: false,
        httpStatus: 403,
        message: "Balance not verified: PayPal reporting permission not granted"
    });
    await promises_1.default.rm(outDir, { recursive: true, force: true });
});
test("balance check creates case folder under out/ on ENOENT", async () => {
    const caseId = "test-balance-enoent";
    const outDir = caseOut(caseId);
    await promises_1.default.rm(outDir, { recursive: true, force: true });
    let calls = 0;
    jest.spyOn(global, "fetch").mockImplementation(async () => {
        calls++;
        if (calls === 1) {
            return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), {
                status: 200, headers: { "content-type": "application/json" }
            });
        }
        return new Response(JSON.stringify({
            balances: [{
                    currency: "USD",
                    total_balance: { currency_code: "USD", value: "5000.00" },
                    available_balance: { currency_code: "USD", value: "5000.00" }
                }]
        }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await (0, evidence_1.checkBusinessBalance)(caseId, "USD");
    expect(result.verified).toBe(true);
    expect(result.total).toBe("5000.00");
    const stat = await promises_1.default.stat(node_path_1.default.join(outDir, "evidence.json"));
    expect(stat.isFile()).toBe(true);
    await promises_1.default.rm(outDir, { recursive: true, force: true });
});
