import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fundCase, getPaymentRecord, refreshPayoutStatus, releaseMilestone, savePaymentRecord } from "../src/milestone";
import { authorizeOrder, confirmOrderWithCard, getAuthorization, getOrder } from "../src/paypal/orders";
import { PayPalApiError, PAYPAL_BASE_URL } from "../src/paypal/client";
import { getBalances, searchTransactions } from "../src/paypal/reporting";
import { validatePaymentEnvironment } from "../src/paypal/config";
import { readEvidence, writeEvidence } from "../src/paypal/evidence";

const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "PAYPAL_BUYER_EMAIL", "PAYPAL_CONTRACTOR_EMAIL"];
const cardVariables = ["PAYPAL_TEST_CARD_NUMBER", "PAYPAL_TEST_CARD_EXPIRY", "PAYPAL_TEST_CARD_SECURITY_CODE", "PAYPAL_TEST_CARD_NAME"];
const caseId = "live-test";
const amount = process.env.PAYPAL_AMOUNT ?? "10.00";
const currency = process.env.PAYPAL_CURRENCY ?? "USD";
const redacted = (value: string): string => {
  for (const secret of [process.env.PAYPAL_CLIENT_SECRET, process.env.PAYPAL_TEST_CARD_NUMBER, process.env.PAYPAL_TEST_CARD_SECURITY_CODE]) {
    if (secret) value = value.split(secret).join("[redacted]");
  }
  return value.replace(/(access_token|client_secret|authorization)["'=:\s]+[^,\s}]+/gi, "$1=[redacted]");
};
const httpStatus = (error: unknown): number | undefined => error instanceof PayPalApiError ? error.status : undefined;
const errorText = (error: unknown): string => redacted(error instanceof PayPalApiError ? error.body : error instanceof Error ? error.message : String(error));
const redactedActionLink = (href: string): string => href.replace(/([?&]token=)[^&]+/i, "$1[redacted]");

async function main(): Promise<void> {
  if (required.some((name) => !process.env[name]) || process.env.PAYPAL_ENV !== "sandbox") {
    console.log("Skipping API-only sandbox payment: required sandbox variables are not set.");
    return;
  }
  validatePaymentEnvironment();
  await fs.rm(path.resolve("out", caseId, "evidence.json"), { force: true });
  let evidence = await readEvidence(caseId);
  evidence.steps = [];
  evidence.reportingErrors = [];
  await writeEvidence(evidence);
  const missingCard = cardVariables.filter((name) => !process.env[name]);
  if (missingCard.length) {
    const message = `Card payment blocked: missing environment variables ${missingCard.join(", ")}.`;
    evidence.steps = [{ step: "confirm-payment-source", status: "BLOCKED", error: message }];
    await writeEvidence(evidence);
    console.log(`BLOCKED confirm-payment-source status BLOCKED: ${message}`);
    return;
  }
  await fs.rm(path.resolve("out", caseId, "paypal.json"), { force: true });

  await fundCase(caseId, amount, currency);
  let record = await getPaymentRecord(caseId);
  if (!record.orderId) throw new Error("Order creation did not store an order ID.");
  evidence.steps!.push({ step: "create-order", paypalId: record.orderId, status: record.orderStatus ?? "CREATED", httpStatus: 201 });
  await writeEvidence(evidence);
  console.log(`PASS create-order ${record.orderId} status ${record.orderStatus ?? "CREATED"} HTTP 201`);

  const confirmRequestId = crypto.randomUUID();
  record.operations ??= [];
  record.operations.push({ operation: "confirm-payment-source", requestId: confirmRequestId, status: "pending", recordedAt: new Date().toISOString() });
  await savePaymentRecord(record);
  try {
    const confirmation = await confirmOrderWithCard(record.orderId, {
      number: process.env.PAYPAL_TEST_CARD_NUMBER!,
      expiry: process.env.PAYPAL_TEST_CARD_EXPIRY!,
      security_code: process.env.PAYPAL_TEST_CARD_SECURITY_CODE!,
      name: process.env.PAYPAL_TEST_CARD_NAME!
    }, confirmRequestId);
    const action = confirmation.raw.links?.find((link) => link.rel === "approve")?.href;
    const operation = record.operations.find((item) => item.operation === "confirm-payment-source");
    if (operation) { operation.status = confirmation.status; operation.recordedAt = new Date().toISOString(); }
    await savePaymentRecord(record);
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "confirm-payment-source", paypalId: record.orderId, status: confirmation.status, httpStatus: 200 });
    await writeEvidence(evidence);
    console.log(`PASS confirm-payment-source ${record.orderId} status ${confirmation.status} HTTP 200`);
    const current = await getOrder(record.orderId);
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "fetch-order", paypalId: record.orderId, status: current.status, httpStatus: 200 });
    await writeEvidence(evidence);
    console.log(`PASS fetch-order ${record.orderId} status ${current.status} HTTP 200`);
    if (confirmation.status === "PAYER_ACTION_REQUIRED") {
      const safeAction = action ? redactedActionLink(action) : "not provided";
      evidence.steps!.push({ step: "card-action", paypalId: record.orderId, status: "BLOCKED", httpStatus: 200, error: `Card needs a further step not completed by the API path; action link: ${safeAction}` });
      await writeEvidence(evidence);
      console.log(`BLOCKED card-action ${record.orderId} status PAYER_ACTION_REQUIRED HTTP 200; action link: ${safeAction}`);
      return;
    }
    if (confirmation.status !== "APPROVED") {
      const error = `Card confirmation returned status ${confirmation.status}; no authorization was attempted.`;
      evidence.steps!.push({ step: "card-authorization", paypalId: record.orderId, status: "BLOCKED", httpStatus: 200, error });
      await writeEvidence(evidence);
      console.log(`BLOCKED card-authorization ${record.orderId} status ${confirmation.status} HTTP 200`);
      return;
    }
  } catch (error) {
    const message = errorText(error);
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "confirm-payment-source", paypalId: record.orderId, status: "BLOCKED", httpStatus: httpStatus(error), error: message });
    await writeEvidence(evidence);
    console.log(`BLOCKED confirm-payment-source ${record.orderId} status BLOCKED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
    return;
  }

  try {
    const current = await getOrder(record.orderId);
    if (current.status !== "APPROVED") throw new Error(`Card-confirmed order status was ${current.status}, not APPROVED.`);
    const authorizeRequestId = crypto.randomUUID();
    record = await getPaymentRecord(caseId);
    record.operations ??= [];
    record.operations.push({ operation: "authorize-order", requestId: authorizeRequestId, status: "pending", recordedAt: new Date().toISOString() });
    await savePaymentRecord(record);
    const authorization = await authorizeOrder(record.orderId, authorizeRequestId);
    if (!authorization.authorizationId || !authorization.expirationTime) throw new Error("Authorization response did not include authorization ID and expiration_time.");
    record = await getPaymentRecord(caseId);
    record.authorizationId = authorization.authorizationId;
    record.authorizedAt = new Date().toISOString();
    record.authorizationStatus = authorization.status ?? "UNKNOWN";
    record.authorizationExpirationTime = authorization.expirationTime;
    const operation = record.operations.find((item) => item.operation === "authorize-order");
    if (operation) { operation.status = record.authorizationStatus; operation.recordedAt = new Date().toISOString(); }
    await savePaymentRecord(record);
    evidence.steps!.push({ step: "authorize-order", paypalId: authorization.authorizationId, status: authorization.status ?? "AUTHORIZED", httpStatus: 201 });
    await writeEvidence(evidence);
    console.log(`PASS authorize-order ${authorization.authorizationId} status ${authorization.status ?? "AUTHORIZED"} HTTP 201`);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "card-authorization", paypalId: record.orderId, status: "BLOCKED", httpStatus: httpStatus(error), error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`BLOCKED card-authorization ${record.orderId} status BLOCKED HTTP ${httpStatus(error) ?? "unknown"}: ${errorText(error)}`);
    return;
  }

  let before;
  try {
    before = await getBalances(currency);
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "before-business-balance", paypalId: record.authorizationId, status: "READ", httpStatus: 200, balance: before });
    await writeEvidence(evidence);
    console.log(`PASS before-business-balance ${record.authorizationId} status READ HTTP 200 balance ${before.total} ${before.currency}`);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.reportingErrors!.push({ endpoint: `${PAYPAL_BASE_URL}/v1/reporting/balances`, httpStatus: httpStatus(error), error: errorText(error) });
    evidence.steps!.push({ step: "before-business-balance", paypalId: record.authorizationId, status: "NOT_VERIFIED", httpStatus: httpStatus(error), error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL before-business-balance ${record.authorizationId} status NOT_VERIFIED HTTP ${httpStatus(error) ?? "unknown"}: ${errorText(error)}`);
    return;
  }

  try {
    await releaseMilestone(caseId, amount);
    record = await getPaymentRecord(caseId);
    const milestone = record.milestones[0];
    const afterCapture = await getBalances(currency);
    const captureTransactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    const captureBalance = Number(afterCapture.total) >= Number(before.total) + Number(amount);
    evidence = await readEvidence(caseId);
    evidence.milestones["1"] = { beforeBusiness: before, afterCaptureBusiness: afterCapture, captureTransactions, checks: { captureCompleted: milestone?.captureStatus === "COMPLETED", captureBalance } };
    evidence.steps!.push({ step: "capture-and-after-capture-balance", paypalId: milestone?.captureId, status: milestone?.captureStatus ?? "UNKNOWN", httpStatus: 201, balance: afterCapture });
    await writeEvidence(evidence);
    console.log(`${milestone?.captureStatus === "COMPLETED" && captureBalance ? "PASS" : "FAIL"} capture-and-after-capture-balance ${milestone?.captureId ?? record.authorizationId} status ${milestone?.captureStatus ?? "UNKNOWN"} HTTP 201 balance ${afterCapture.total} ${afterCapture.currency}`);
    if (milestone?.captureStatus !== "COMPLETED" || !captureBalance) return;
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "capture-and-after-capture-balance", paypalId: record.authorizationId, status: "FAILED", httpStatus: httpStatus(error), error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL capture-and-after-capture-balance ${record.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}: ${errorText(error)}`);
    return;
  }

  try {
    let payout = await refreshPayoutStatus(caseId);
    while (payout !== "SUCCESS" && payout !== "DENIED" && payout !== "CANCELED") {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      payout = await refreshPayoutStatus(caseId);
    }
    record = await getPaymentRecord(caseId);
    const afterPayout = await getBalances(currency);
    const payoutTransactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    const milestone = record.milestones[0];
    evidence = await readEvidence(caseId);
    evidence.milestones["1"] = { ...(evidence.milestones["1"] ?? {}), afterPayoutBusiness: afterPayout, payoutTransactions, checks: { ...(evidence.milestones["1"]?.checks ?? {}), payoutSuccess: payout === "SUCCESS" } };
    evidence.steps!.push({ step: "payout-and-after-payout-balance", paypalId: milestone?.payoutBatchId, status: payout ?? "UNKNOWN", httpStatus: 200, balance: afterPayout });
    await writeEvidence(evidence);
    console.log(`${payout === "SUCCESS" ? "PASS" : "FAIL"} payout-and-after-payout-balance ${milestone?.payoutBatchId ?? record.authorizationId} status ${payout ?? "UNKNOWN"} HTTP 200 balance ${afterPayout.total} ${afterPayout.currency}`);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "payout-and-after-payout-balance", paypalId: record.authorizationId, status: "FAILED", httpStatus: httpStatus(error), error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL payout-and-after-payout-balance ${record.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}: ${errorText(error)}`);
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL API payment: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
