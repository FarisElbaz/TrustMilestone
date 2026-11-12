import { createAuthorizeOrderWithStatus, probeOrder } from "../src/paypal/orders";
import { PayPalApiError, resetPayPalTokenCache, PAYPAL_BASE_URL } from "../src/paypal/client";
import { validatePaymentEnvironment } from "../src/paypal/config";

const amount = process.env.PAYPAL_AMOUNT ?? "0.01";
const currency = process.env.PAYPAL_CURRENCY ?? "USD";
const clientPrefix = (process.env.PAYPAL_CLIENT_ID ?? "").trim().slice(0, 6);
const orderUrl = (id: string) => `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(id)}`;

function statusOf(error: unknown): number | undefined {
  return error instanceof PayPalApiError ? error.status : undefined;
}

async function runDiagnostic(): Promise<void> {
  validatePaymentEnvironment({ requireAmount: true, amount, currency });
  const created = await createAuthorizeOrderWithStatus(amount, currency, `diagnostic-${Date.now()}`);
  const { orderId } = created.order;
  console.log(`CREATE URL: ${PAYPAL_BASE_URL}/v2/checkout/orders`);
  console.log(`CREATE method: POST; HTTP ${created.httpStatus}`);
  console.log(`PAYPAL_CLIENT_ID prefix: ${clientPrefix}`);
  console.log(`CREATE order ID: ${orderId}; status: ${created.orderStatus ?? "UNKNOWN"}`);
  console.log(`FETCH URL: ${orderUrl(orderId)}`);
  try {
    const fetched = await probeOrder(orderId);
    console.log(`FETCH method: GET; HTTP ${fetched.httpStatus}`);
    console.log(`FETCH order ID: ${orderId}; status: ${fetched.orderStatus}`);
    if (fetched.httpStatus === 200) {
      console.log("OUTCOME: Fetch returned 200: the earlier probe ID was the problem.");
      return;
    }
  } catch (error) {
    const status = statusOf(error);
    console.log(`FETCH method: GET; HTTP ${status ?? "unknown"}`);
    if (status === 401 || status === 403) {
      console.log("OUTCOME: Fetch returned 401 or 403; clearing the cached token and requesting a new one.");
      resetPayPalTokenCache();
      const retry = await createAuthorizeOrderWithStatus(amount, currency, `diagnostic-retry-${Date.now()}`);
      console.log(`RETRY CREATE method: POST; HTTP ${retry.httpStatus}; order ID: ${retry.order.orderId}`);
      const retryFetch = await probeOrder(retry.order.orderId);
      console.log(`RETRY FETCH URL: ${orderUrl(retry.order.orderId)}`);
      console.log(`RETRY FETCH method: GET; HTTP ${retryFetch.httpStatus}; status: ${retryFetch.orderStatus}`);
      return;
    }
    if (status === 404) {
      console.log(`OUTCOME: Fetch returned 404 on the new order: URL or ID handling is wrong. Exact ID string: ${JSON.stringify(orderId)}; whitespace: ${/\s/.test(orderId) ? "present" : "none"}; quotes: ${/^["']|["']$/.test(orderId) ? "present" : "none"}`);
      console.log(`FETCH response body: ${error instanceof PayPalApiError ? error.body : String(error)}`);
      return;
    }
    console.log(`FETCH response body: ${error instanceof PayPalApiError ? error.body : String(error)}`);
    throw error;
  }
}

runDiagnostic().catch((error: unknown) => {
  console.error(`FAIL diagnostic: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
