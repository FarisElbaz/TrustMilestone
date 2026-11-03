"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../src/paypal/client");
const orders_1 = require("../src/paypal/orders");
const payments_1 = require("../src/paypal/payments");
function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
beforeEach(() => {
    process.env.PAYPAL_ENV = "sandbox";
    process.env.PAYPAL_CLIENT_ID = "test-client";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    (0, client_1.resetPayPalTokenCache)();
});
afterEach(() => jest.restoreAllMocks());
test("caches OAuth and sends request IDs on POST operations", async () => {
    const calls = [];
    jest.spyOn(global, "fetch").mockImplementation(async (_input, init) => {
        calls.push(init ?? {});
        if (calls.length === 1)
            return response({ access_token: "token", expires_in: 3600 });
        if (calls.length === 2)
            return response({ id: "order-1", links: [{ rel: "approve", href: "https://sandbox/approve" }] });
        return response({ id: "capture-1" });
    });
    await expect((0, orders_1.createAuthorizeOrder)("10.00", "USD", "c01")).resolves.toEqual({ orderId: "order-1", approvalUrl: "https://sandbox/approve" });
    await expect((0, orders_1.captureAuthorization)("auth-1", "1.00", "USD")).resolves.toMatchObject({ captureId: "capture-1" });
    expect(calls[1].headers).toHaveProperty("PayPal-Request-Id");
    expect(calls[2].headers).toHaveProperty("PayPal-Request-Id");
});
test("maps order authorization and uses the documented void and payout paths", async () => {
    const urls = [];
    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
        urls.push(String(input));
        if (urls.length === 1)
            return response({ access_token: "token", expires_in: 3600 });
        if (urls.length === 2)
            return response({ status: "APPROVED", purchase_units: [{ payments: { authorizations: [{ id: "auth-1" }] } }] });
        return response({ batch_header: { payout_batch_id: "batch-1", batch_status: "PENDING" } });
    });
    await expect((0, orders_1.getOrder)("order-1")).resolves.toEqual({ status: "APPROVED", authorizationId: "auth-1" });
    await expect((0, payments_1.sendPayout)("c01", "contractor@example.test", "1.00", "USD")).resolves.toMatchObject({ batchId: "batch-1" });
    expect(urls[1]).toContain("/v2/checkout/orders/order-1");
    expect(urls[2]).toContain("/v1/payments/payouts");
    (0, client_1.resetPayPalTokenCache)();
    const voidFetch = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
        urls.push(String(input));
        return urls.length === 4 ? response({ access_token: "token-2", expires_in: 3600 }) : response({});
    });
    await (0, payments_1.voidAuthorization)("auth-1");
    expect(String(voidFetch.mock.calls[voidFetch.mock.calls.length - 1][0])).toContain("/v2/payments/authorizations/auth-1/void");
});
