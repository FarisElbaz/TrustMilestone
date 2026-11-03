import { resetPayPalTokenCache } from "../src/paypal/client";
import { captureAuthorization, createAuthorizeOrder, getOrder } from "../src/paypal/orders";
import { sendPayout, voidAuthorization } from "../src/paypal/payments";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  process.env.PAYPAL_ENV = "sandbox";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  resetPayPalTokenCache();
});

afterEach(() => jest.restoreAllMocks());

test("caches OAuth and sends request IDs on POST operations", async () => {
  const calls: RequestInit[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (_input, init) => {
    calls.push(init ?? {});
    if (calls.length === 1) return response({ access_token: "token", expires_in: 3600 });
    if (calls.length === 2) return response({ id: "order-1", links: [{ rel: "approve", href: "https://sandbox/approve" }] });
    return response({ id: "capture-1" });
  });
  await expect(createAuthorizeOrder("10.00", "USD", "c01")).resolves.toEqual({ orderId: "order-1", approvalUrl: "https://sandbox/approve" });
  await expect(captureAuthorization("auth-1", "1.00", "USD")).resolves.toMatchObject({ captureId: "capture-1" });
  expect(calls[1].headers).toHaveProperty("PayPal-Request-Id");
  expect(calls[2].headers).toHaveProperty("PayPal-Request-Id");
});

test("maps order authorization and uses the documented void and payout paths", async () => {
  const urls: string[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return response({ access_token: "token", expires_in: 3600 });
    if (urls.length === 2) return response({ status: "APPROVED", purchase_units: [{ payments: { authorizations: [{ id: "auth-1" }] } }] });
    return response({ batch_header: { payout_batch_id: "batch-1", batch_status: "PENDING" } });
  });
  await expect(getOrder("order-1")).resolves.toEqual({ status: "APPROVED", authorizationId: "auth-1" });
  await expect(sendPayout("c01", "contractor@example.test", "1.00", "USD")).resolves.toMatchObject({ batchId: "batch-1" });
  expect(urls[1]).toContain("/v2/checkout/orders/order-1");
  expect(urls[2]).toContain("/v1/payments/payouts");
  resetPayPalTokenCache();
  const voidFetch = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
    urls.push(String(input));
    return urls.length === 4 ? response({ access_token: "token-2", expires_in: 3600 }) : response({});
  });
  await voidAuthorization("auth-1");
  expect(String(voidFetch.mock.calls[voidFetch.mock.calls.length - 1][0])).toContain("/v2/payments/authorizations/auth-1/void");
});
