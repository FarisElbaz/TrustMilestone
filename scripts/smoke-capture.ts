import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { captureAuthorization, createAuthorizeOrder, getOrder } from "../src/paypal/orders";

async function main(): Promise<void> {
  const amount = process.env.PAYPAL_SMOKE_AMOUNT ?? "1.00";
  const currency = process.env.PAYPAL_SMOKE_CURRENCY ?? "USD";
  const caseId = `smoke-${Date.now()}`;
  const order = await createAuthorizeOrder(amount, currency, caseId);
  console.log(`Approve this sandbox order as the buyer: ${order.approvalUrl}`);
  const prompt = createInterface({ input, output });
  await prompt.question("Press Enter after approval: ");
  prompt.close();
  const approved = await getOrder(order.orderId);
  if (!approved.authorizationId) throw new Error(`Order status is ${approved.status}; no authorization was returned.`);
  const capture = await captureAuthorization(approved.authorizationId, process.env.PAYPAL_SMOKE_CAPTURE_AMOUNT ?? "0.50", currency);
  console.log(JSON.stringify({ orderId: order.orderId, authorizationId: approved.authorizationId, capture }, null, 2));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
