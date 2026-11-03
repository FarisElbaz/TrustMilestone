import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fundCase, getPaymentRecord, paymentStatus, refreshPayoutStatus, releaseMilestone } from "../src/milestone";
import { captureAuthorization, getAuthorization, getOrder } from "../src/paypal/orders";
import { voidAuthorization } from "../src/paypal/payments";
import { validatePaymentEnvironment } from "../src/paypal/config";
import { verify } from "../src/verify";

const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "PAYPAL_BUYER_EMAIL", "PAYPAL_CONTRACTOR_EMAIL"];
if (required.some((name) => !process.env[name]) || process.env.PAYPAL_ENV !== "sandbox") {
  console.log("Skipping live sandbox test: required sandbox variables are not set.");
  process.exit(0);
}
validatePaymentEnvironment();
const rl = createInterface({ input, output });
const amount = process.env.PAYPAL_AMOUNT ?? "10.00";
const currency = process.env.PAYPAL_CURRENCY ?? "USD";
const waitForApproval = async (orderId: string, approvalUrl: string, label: string) => {
  console.log(`${label}: approve this URL as ${process.env.PAYPAL_BUYER_EMAIL}:`);
  console.log(approvalUrl);
  await rl.question("Press Enter after approval to poll PayPal: ");
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await getOrder(orderId);
    if (current.status === "APPROVED") return;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`${label} did not become approved within 15 minutes.`);
};
async function main() {
  const remainderCase = `live-remainder-${Date.now()}`;
  const remainder = await fundCase(remainderCase, amount, currency);
  console.log(`PASS order created: ${remainder.orderId} status ${remainder.orderStatus}`);
  await waitForApproval(remainder.orderId!, remainder.approvalUrl!, "Remainder test");
  await paymentStatus(remainderCase);
  await releaseMilestone(remainderCase, (Number(amount) / 2).toFixed(2));
  const remainderRecord = await getPaymentRecord(remainderCase);
  const remainderAuth = remainderRecord.authorizationId!;
  const authorization = await getAuthorization(remainderAuth);
  console.log(`PASS remainder authorization ${remainderAuth} status ${authorization.status ?? "unknown"} amount ${authorization.amount?.value ?? "unknown"}`);
  console.log(`Capture time: ${remainderRecord.milestones[0]?.timestamp ?? "unknown"}; expiration_time: ${remainderRecord.authorizationExpirationTime ?? "unknown"}`);

  const voidCase = `live-void-${Date.now()}`;
  const voidRecord = await fundCase(voidCase, amount, currency);
  console.log(`PASS void order created: ${voidRecord.orderId} status ${voidRecord.orderStatus}`);
  await waitForApproval(voidRecord.orderId!, voidRecord.approvalUrl!, "Void test");
  await paymentStatus(voidCase);
  const voidAuth = (await getPaymentRecord(voidCase)).authorizationId!;
  await voidAuthorization(voidAuth);
  const voidResult = await getAuthorization(voidAuth);
  console.log(`PASS void ${voidAuth} status ${voidResult.status ?? "unknown"}`);
  try {
    await captureAuthorization(voidAuth, "0.01", currency);
    console.log("FAIL capture unexpectedly succeeded after void.");
  } catch (error) {
    console.log(`PASS void capture refusal: ${error instanceof Error ? error.message : String(error)}`);
  }

  const caseId = "c01";
  const funded = await fundCase(caseId, amount, currency);
  console.log(`Full flow order: ${funded.orderId ?? "existing"}`);
  if (!funded.authorizationId) {
    if (!funded.orderId) throw new Error("No live order recorded for c01.");
    console.log(`Approve: ${funded.approvalUrl}`);
    await waitForApproval(funded.orderId, funded.approvalUrl!, "Full flow");
    await paymentStatus(caseId);
  }
  const decision = await verify("testset/cases/c01", "testset/cases/c01/reference");
  if (decision.decision !== "release") throw new Error(`Full flow returned ${decision.decision}.`);
  const payoutStatus = await refreshPayoutStatus(caseId);
  console.log(`PASS release and payout status ${payoutStatus ?? "unknown"}`);

  const rejectCase = "c01-reject";
  const rejectFunded = await fundCase(rejectCase, amount, currency);
  console.log(`Approve: ${rejectFunded.approvalUrl}`);
  if (!rejectFunded.authorizationId) {
    await waitForApproval(rejectFunded.orderId!, rejectFunded.approvalUrl!, "Reject flow");
    await paymentStatus(rejectCase);
  }
  const rejected = await verify("testset/cases/c01", "testset/cases/c01/variants/V2_subtle_bug", { paymentCaseId: rejectCase });
  if (rejected.decision !== "reject") throw new Error(`Reject flow returned ${rejected.decision}.`);
  const rejectRecord = await getPaymentRecord(rejectCase);
  if (rejectRecord.authorizationStatus !== "VOIDED") throw new Error(`Reject authorization status was ${rejectRecord.authorizationStatus ?? "unknown"}.`);
  console.log(`PASS reject authorization ${rejectRecord.authorizationId ?? "unknown"} status ${rejectRecord.authorizationStatus}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? `FAIL ${error.message}` : `FAIL ${String(error)}`); process.exitCode = 1; }).finally(() => rl.close());
