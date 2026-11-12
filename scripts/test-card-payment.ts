import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getPaymentRecord, refreshPayoutStatus, releaseMilestone, savePaymentRecord, type PayPalRecord } from "../src/milestone";
import { authorizeOrder, createAuthorizeOrderWithCard, getAuthorization, getOrder } from "../src/paypal/orders";
import { PayPalApiError, PAYPAL_BASE_URL } from "../src/paypal/client";
import { getBalances, searchTransactions } from "../src/paypal/reporting";
import { validatePaymentEnvironment } from "../src/paypal/config";
import { readEvidence, writeEvidence } from "../src/paypal/evidence";

const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "PAYPAL_BUYER_EMAIL", "PAYPAL_CONTRACTOR_EMAIL"];
const cardVariables = ["PAYPAL_TEST_CARD_NUMBER", "PAYPAL_TEST_CARD_EXPIRY", "PAYPAL_TEST_CARD_SECURITY_CODE", "PAYPAL_TEST_CARD_NAME"];
const caseId = "live-test";
const amount = process.env.PAYPAL_AMOUNT ?? "10.00";
const currency = process.env.PAYPAL_CURRENCY ?? "USD";

function httpStatus(error: unknown): number | undefined {
  return error instanceof PayPalApiError ? error.status : undefined;
}

function errorText(error: unknown): string {
  const body = error instanceof PayPalApiError ? error.body : error instanceof Error ? error.message : String(error);
  return body
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(access_token|client_secret|authorization)["'=:\s]+[^,\s}]+/gi, "$1=[redacted]");
}

function safeLink(href: string): string {
  return href.replace(/([?&](?:token|ba_token)=)[^&]+/gi, "$1[redacted]");
}

function recordStep(
  evidence: Awaited<ReturnType<typeof readEvidence>>,
  step: string,
  paypalId: string | undefined,
  status: string,
  httpCode: number | undefined,
  extra: { balance?: unknown; error?: string } = {}
): void {
  evidence.steps ??= [];
  evidence.steps.push({ step, paypalId, status, httpStatus: httpCode, ...extra });
}

async function main(): Promise<void> {
  await fs.rm(path.resolve("out", caseId, "paypal.json"), { force: true });
  await fs.rm(path.resolve("out", caseId, "evidence.json"), { force: true });
  let evidence = await readEvidence(caseId);
  evidence.steps = [];
  evidence.reportingErrors = [];
  await writeEvidence(evidence);

  if (required.some((name) => !process.env[name]) || process.env.PAYPAL_ENV !== "sandbox") {
    const message = "Required sandbox PayPal environment variables are not set.";
    recordStep(evidence, "card-payment", undefined, "BLOCKED", undefined, { error: message });
    await writeEvidence(evidence);
    console.log(`BLOCKED card-payment status BLOCKED: ${message}`);
    return;
  }
  validatePaymentEnvironment();
  const missingCard = cardVariables.filter((name) => !process.env[name]);
  if (missingCard.length) {
    const message = `Card payment blocked: missing environment variables ${missingCard.join(", ")}.`;
    recordStep(evidence, "create-order", undefined, "BLOCKED", undefined, { error: message });
    recordStep(evidence, "card-payment", undefined, "BLOCKED", undefined, { error: message });
    await writeEvidence(evidence);
    console.log(`BLOCKED create-order status BLOCKED: ${message}`);
    return;
  }

  const createRequestId = crypto.randomUUID();
  const record: PayPalRecord = {
    caseId,
    amount,
    currency,
    createdAt: new Date().toISOString(),
    milestones: [],
    paypalResponses: [],
    operations: [{ operation: "create-order", requestId: createRequestId, status: "pending", recordedAt: new Date().toISOString() }]
  };
  await savePaymentRecord(record);

  let currentRecord = record;
  try {
    const created = await createAuthorizeOrderWithCard(amount, currency, caseId, {
      number: process.env.PAYPAL_TEST_CARD_NUMBER!,
      expiry: process.env.PAYPAL_TEST_CARD_EXPIRY!,
      security_code: process.env.PAYPAL_TEST_CARD_SECURITY_CODE!,
      name: process.env.PAYPAL_TEST_CARD_NAME!
    }, createRequestId);
    currentRecord.orderId = created.orderId;
    currentRecord.approvalUrl = created.approvalUrl;
    currentRecord.orderStatus = created.orderStatus;
    const operation = currentRecord.operations?.find((item) => item.operation === "create-order");
    if (operation) { operation.status = created.orderStatus; operation.recordedAt = new Date().toISOString(); }
    await savePaymentRecord(currentRecord);
    recordStep(evidence, "create-order", created.orderId, created.orderStatus, created.httpStatus);
    await writeEvidence(evidence);
    console.log(`PASS create-order ${created.orderId} status ${created.orderStatus} HTTP ${created.httpStatus}`);
  } catch (error) {
    const message = errorText(error);
    recordStep(evidence, "create-order", undefined, "BLOCKED", httpStatus(error), { error: message });
    recordStep(evidence, "card-payment", undefined, "BLOCKED", httpStatus(error), { error: message });
    await writeEvidence(evidence);
    console.log(`BLOCKED create-order status BLOCKED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
    return;
  }

  const orderId = currentRecord.orderId!;
  try {
    const order = await getOrder(orderId);
    currentRecord.orderStatus = order.status;
    await savePaymentRecord(currentRecord);
    recordStep(evidence, "fetch-order", orderId, order.status, 200);
    await writeEvidence(evidence);
    console.log(`PASS fetch-order ${orderId} status ${order.status} HTTP 200`);
    const action = order.raw?.links?.find((link) => link.rel === "approve")?.href;
    if (action) {
      const message = `Card needed a further step; payer-action link: ${safeLink(action)}`;
      recordStep(evidence, "card-payment", orderId, "BLOCKED", 200, { error: message });
      await writeEvidence(evidence);
      console.log(`BLOCKED card-payment ${orderId} status ${order.status} HTTP 200; payer-action link: ${safeLink(action)}`);
      return;
    }
    let authorization;
    if (order.authorizationId) {
      authorization = await getAuthorization(order.authorizationId);
    } else {
      const authorizeRequestId = crypto.randomUUID();
      currentRecord.operations?.push({ operation: "authorize-order", requestId: authorizeRequestId, status: "pending", recordedAt: new Date().toISOString() });
      await savePaymentRecord(currentRecord);
      authorization = await authorizeOrder(orderId, authorizeRequestId);
    }
    if (!authorization.authorizationId || !authorization.expirationTime) throw new Error("Authorization response did not include authorization ID and expiration_time.");
    currentRecord.authorizationId = authorization.authorizationId;
    currentRecord.authorizationStatus = authorization.status ?? "UNKNOWN";
    currentRecord.authorizationExpirationTime = authorization.expirationTime;
    currentRecord.authorizedAt = new Date().toISOString();
    const operation = currentRecord.operations?.find((item) => item.operation === "authorize-order");
    if (operation) { operation.status = currentRecord.authorizationStatus; operation.recordedAt = new Date().toISOString(); }
    await savePaymentRecord(currentRecord);
    recordStep(evidence, "authorize-order", authorization.authorizationId, currentRecord.authorizationStatus, order.authorizationId ? 200 : 201);
    await writeEvidence(evidence);
    console.log(`PASS authorize-order ${authorization.authorizationId} status ${currentRecord.authorizationStatus} HTTP 201`);
  } catch (error) {
    const message = errorText(error);
    recordStep(evidence, "card-payment", orderId, "BLOCKED", httpStatus(error), { error: message });
    await writeEvidence(evidence);
    console.log(`BLOCKED card-payment ${orderId} status BLOCKED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
    return;
  }

  let before;
  try {
    before = await getBalances(currency);
    recordStep(evidence, "before-business-balance", currentRecord.authorizationId, "READ", 200, { balance: before });
    await writeEvidence(evidence);
    console.log(`PASS before-business-balance ${currentRecord.authorizationId} status READ HTTP 200 balance ${before.total} ${before.currency}`);
  } catch (error) {
    const message = errorText(error);
    evidence.reportingErrors!.push({ endpoint: `${PAYPAL_BASE_URL}/v1/reporting/balances`, httpStatus: httpStatus(error), error: message });
    recordStep(evidence, "before-business-balance", currentRecord.authorizationId, "NOT_VERIFIED", httpStatus(error), { error: message });
    await writeEvidence(evidence);
    console.log(`FAIL before-business-balance ${currentRecord.authorizationId} status NOT_VERIFIED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
    return;
  }

  try {
    await releaseMilestone(caseId, amount);
    currentRecord = await getPaymentRecord(caseId);
    const milestone = currentRecord.milestones[0];
    const afterCapture = await getBalances(currency);
    const transactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    const balancePassed = Number(afterCapture.total) >= Number(before.total) + Number(amount);
    evidence.milestones["1"] = {
      beforeBusiness: before,
      afterCaptureBusiness: afterCapture,
      captureTransactions: transactions,
      checks: { captureCompleted: milestone?.captureStatus === "COMPLETED", captureBalance: balancePassed }
    };
    recordStep(evidence, "capture-and-after-capture-balance", milestone?.captureId, milestone?.captureStatus ?? "UNKNOWN", 201, { balance: afterCapture });
    if (milestone?.payoutBatchId) {
      recordStep(evidence, "payout-submission", milestone.payoutBatchId, milestone.payoutStatus ?? "PENDING", 201, { error: "Payout was submitted by the existing release flow before the capture-balance check failed; final payout status was not polled." });
    }
    await writeEvidence(evidence);
    console.log(`${milestone?.captureStatus === "COMPLETED" && balancePassed ? "PASS" : "FAIL"} capture-and-after-capture-balance ${milestone?.captureId ?? currentRecord.authorizationId} status ${milestone?.captureStatus ?? "UNKNOWN"} HTTP 201 balance ${afterCapture.total} ${afterCapture.currency}`);
    if (milestone?.captureStatus !== "COMPLETED" || !balancePassed) return;
  } catch (error) {
    const message = errorText(error);
    recordStep(evidence, "capture-and-after-capture-balance", currentRecord.authorizationId, "FAILED", httpStatus(error), { error: message });
    await writeEvidence(evidence);
    console.log(`FAIL capture-and-after-capture-balance ${currentRecord.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
    return;
  }

  try {
    let payout = await refreshPayoutStatus(caseId);
    while (payout !== "SUCCESS" && payout !== "DENIED" && payout !== "CANCELED") {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      payout = await refreshPayoutStatus(caseId);
    }
    currentRecord = await getPaymentRecord(caseId);
    const afterPayout = await getBalances(currency);
    const transactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    const milestone = currentRecord.milestones[0];
    evidence.milestones["1"] = {
      ...(evidence.milestones["1"] ?? {}),
      afterPayoutBusiness: afterPayout,
      payoutTransactions: transactions,
      checks: { ...(evidence.milestones["1"]?.checks ?? {}), payoutSuccess: payout === "SUCCESS" }
    };
    recordStep(evidence, "payout-and-after-payout-balance", milestone?.payoutBatchId, payout ?? "UNKNOWN", 200, { balance: afterPayout });
    await writeEvidence(evidence);
    console.log(`${payout === "SUCCESS" ? "PASS" : "FAIL"} payout-and-after-payout-balance ${milestone?.payoutBatchId ?? currentRecord.authorizationId} status ${payout ?? "UNKNOWN"} HTTP 200 balance ${afterPayout.total} ${afterPayout.currency}`);
  } catch (error) {
    const message = errorText(error);
    recordStep(evidence, "payout-and-after-payout-balance", currentRecord.authorizationId, "FAILED", httpStatus(error), { error: message });
    await writeEvidence(evidence);
    console.log(`FAIL payout-and-after-payout-balance ${currentRecord.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}: ${message}`);
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL card payment: ${errorText(error)}`);
  process.exitCode = 1;
});
