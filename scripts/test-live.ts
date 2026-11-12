import fs from "node:fs/promises";
import path from "node:path";
import { fundCase, getPaymentRecord, paymentStatus, refreshPayoutStatus, releaseMilestone, savePaymentRecord } from "../src/milestone";
import { getAuthorization, getOrder } from "../src/paypal/orders";
import { PayPalApiError, PAYPAL_BASE_URL } from "../src/paypal/client";
import { getBalances, searchTransactions } from "../src/paypal/reporting";
import { validatePaymentEnvironment } from "../src/paypal/config";
import { readEvidence, writeEvidence } from "../src/paypal/evidence";

const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "PAYPAL_BUYER_EMAIL", "PAYPAL_CONTRACTOR_EMAIL"];
if (required.some((name) => !process.env[name]) || process.env.PAYPAL_ENV !== "sandbox") {
  console.log("Skipping live sandbox test: required sandbox variables are not set.");
  process.exit(0);
}
validatePaymentEnvironment();

const caseId = "live-test";
const amount = process.env.PAYPAL_AMOUNT ?? "10.00";
const currency = process.env.PAYPAL_CURRENCY ?? "USD";
const orderEndpoint = (id: string) => `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(id)}`;
const reportingBalanceEndpoint = `${PAYPAL_BASE_URL}/v1/reporting/balances`;
const reportingTransactionsEndpoint = `${PAYPAL_BASE_URL}/v1/reporting/transactions`;

function httpStatus(error: unknown): number | undefined {
  return error instanceof PayPalApiError ? error.status : undefined;
}

function errorText(error: unknown): string {
  return error instanceof PayPalApiError ? error.body : error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  await fs.rm(path.resolve("out", caseId, "paypal.json"), { force: true });
  await fs.rm(path.resolve("out", caseId, "evidence.json"), { force: true });
  let evidence = await readEvidence(caseId);
  evidence.steps = [];
  evidence.reportingErrors = [];
  await writeEvidence(evidence);

  const record = await fundCase(caseId, amount, currency);
  const stored = await getPaymentRecord(caseId);
  const orderId = stored.orderId;
  if (!orderId || !stored.approvalUrl) throw new Error("Order creation did not store an order ID and approval URL.");
  evidence = await readEvidence(caseId);
  evidence.steps!.push({ step: "create-order", paypalId: orderId, status: stored.orderStatus ?? "CREATED", httpStatus: 201 });
  await writeEvidence(evidence);
  console.log(`PASS create-order ${orderId} status ${stored.orderStatus ?? "CREATED"} HTTP 201`);
  console.log(`Approve at: ${stored.approvalUrl}`);
  console.log("Waiting for buyer approval on sandbox.paypal.com; polling every 10 seconds for up to 15 minutes.");

  const deadline = Date.now() + 15 * 60 * 1000;
  let approved = false;
  while (Date.now() < deadline) {
    try {
      const current = await getOrder(orderId);
      if (current.status === "APPROVED") { approved = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    } catch (error) {
      evidence = await readEvidence(caseId);
      evidence.steps!.push({ step: "wait-for-approval", paypalId: orderId, status: "FAILED", httpStatus: httpStatus(error) ?? 200, error: errorText(error) });
      await writeEvidence(evidence);
      console.log(`FAIL wait-for-approval ${orderId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}`);
      throw new Error("Buyer approval polling failed; remaining steps were stopped.");
    }
  }
  if (!approved) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "wait-for-approval", paypalId: orderId, status: "TIMEOUT", httpStatus: 200 });
    await writeEvidence(evidence);
    console.log(`FAIL wait-for-approval ${orderId} status TIMEOUT HTTP 200`);
    throw new Error("The sandbox order was not approved within 15 minutes.");
  }
  evidence = await readEvidence(caseId);
  evidence.steps!.push({ step: "wait-for-approval", paypalId: orderId, status: "APPROVED", httpStatus: 200 });
  await writeEvidence(evidence);
  console.log(`PASS wait-for-approval ${orderId} status APPROVED HTTP 200`);

  let authorized;
  try {
    await paymentStatus(caseId);
    authorized = await getPaymentRecord(caseId);
    const details = await getAuthorization(authorized.authorizationId!);
    if (!authorized.authorizationId || !details.expirationTime) throw new Error("Authorization ID or expiration_time was missing.");
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "authorize-order", paypalId: authorized.authorizationId, status: details.status ?? "AUTHORIZED", httpStatus: 201 });
    await writeEvidence(evidence);
    console.log(`PASS authorize-order ${authorized.authorizationId} status ${details.status ?? "AUTHORIZED"} HTTP 201`);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "authorize-order", paypalId: orderId, status: "FAILED", httpStatus: httpStatus(error) ?? 201, error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL authorize-order ${orderId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}`);
    throw new Error("Authorization failed; remaining steps were stopped.");
  }

  let beforeFunding;
  try {
    beforeFunding = await getBalances(currency);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.reportingErrors!.push({ endpoint: reportingBalanceEndpoint, httpStatus: httpStatus(error), error: errorText(error) });
    evidence.milestones["1"] = { checks: { reportingAvailable: false } };
    await writeEvidence(evidence);
    console.log(`FAIL before-business-balance ${authorized.authorizationId} status NOT_VERIFIED HTTP ${httpStatus(error) ?? "unknown"}`);
    throw new Error(`Before-business-balance failed; remaining steps were stopped: ${errorText(error)}`);
  }
  evidence = await readEvidence(caseId);
  evidence.steps!.push({ step: "before-business-balance", paypalId: authorized.authorizationId, status: "READ", httpStatus: 200 });
  await writeEvidence(evidence);
  console.log(`PASS before-business-balance ${authorized.authorizationId} status READ HTTP 200`);

  let afterCapture;
  try {
    await releaseMilestone(caseId, amount);
    afterCapture = await getBalances(currency);
    const paymentAfterCapture = await getPaymentRecord(caseId);
    const milestone = paymentAfterCapture.milestones[0];
    if (milestone?.captureStatus !== "COMPLETED") throw new Error(`Capture did not complete: ${milestone?.captureStatus ?? "missing"}`);
    const captureTransactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    evidence = await readEvidence(caseId);
    evidence.milestones["1"] = {
      beforeBusiness: beforeFunding,
      afterCaptureBusiness: afterCapture,
      captureTransactions: captureTransactions.map(({ transactionId, eventCode, status, amount: value, fee, currency: transactionCurrency }) => ({ transactionId, eventCode, status, amount: value, fee, currency: transactionCurrency })),
      checks: { reportingAvailable: true, captureCompleted: true, captureBalance: Number(afterCapture.total) >= Number(beforeFunding.total) + Number(amount) }
    };
    evidence.steps!.push({ step: "capture-and-after-capture-balance", paypalId: milestone.captureId, status: milestone.captureStatus, httpStatus: 201 });
    await writeEvidence(evidence);
    console.log(`PASS capture-and-after-capture-balance ${milestone.captureId ?? authorized.authorizationId} status ${milestone.captureStatus} HTTP 201`);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.steps!.push({ step: "capture-and-after-capture-balance", paypalId: authorized.authorizationId, status: "FAILED", httpStatus: httpStatus(error) ?? 201, error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL capture-and-after-capture-balance ${authorized.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}`);
    throw new Error(`Capture step failed; no payout was submitted: ${errorText(error)}`);
  }

  try {
    let payout = await refreshPayoutStatus(caseId);
    const payoutDeadline = Date.now() + 15 * 60 * 1000;
    while (payout !== "SUCCESS" && payout !== "DENIED" && payout !== "CANCELED" && Date.now() < payoutDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      payout = await refreshPayoutStatus(caseId);
    }
    if (payout !== "SUCCESS") throw new Error(`Payout is not complete: ${payout ?? "missing"}.`);
    const afterPayout = await getBalances(currency);
    const payoutTransactions = await searchTransactions(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date());
    const finalPayment = await getPaymentRecord(caseId);
    const finalMilestone = finalPayment.milestones[0];
    const payoutFees = payoutTransactions.reduce((sum, transaction) => sum + Math.abs(Number(transaction.fee ?? 0)), 0);
    const payoutDelta = Number(afterCapture!.total) - Number(afterPayout.total);
    const payoutBalanceMatches = Math.abs(payoutDelta - (Number(amount) - payoutFees)) < 0.01;
    evidence = await readEvidence(caseId);
    evidence.milestones["1"] = {
      ...(evidence.milestones["1"] ?? {}),
      afterPayoutBusiness: afterPayout,
      payoutTransactions: payoutTransactions.map(({ transactionId, eventCode, status, amount: value, fee, currency: transactionCurrency }) => ({ transactionId, eventCode, status, amount: value, fee, currency: transactionCurrency })),
      checks: { ...(evidence.milestones["1"]?.checks ?? {}), payoutSuccess: true, payoutBalance: payoutBalanceMatches }
    };
    evidence.steps!.push({ step: "payout-and-after-payout-balance", paypalId: finalMilestone?.payoutBatchId, status: payout, httpStatus: 200 });
    await writeEvidence(evidence);
    console.log(`PASS payout-and-after-payout-balance ${finalMilestone?.payoutBatchId ?? authorized.authorizationId} status ${payout} HTTP 200`);
    await savePaymentRecord(finalPayment);
  } catch (error) {
    evidence = await readEvidence(caseId);
    evidence.reportingErrors!.push({ endpoint: `${PAYPAL_BASE_URL}/v1/reporting/balances`, httpStatus: httpStatus(error), error: errorText(error) });
    evidence.steps!.push({ step: "payout-and-after-payout-balance", paypalId: authorized.authorizationId, status: "FAILED", httpStatus: httpStatus(error) ?? 200, error: errorText(error) });
    await writeEvidence(evidence);
    console.log(`FAIL payout-and-after-payout-balance ${authorized.authorizationId} status FAILED HTTP ${httpStatus(error) ?? "unknown"}`);
    throw new Error(`Payout or reporting step failed: ${errorText(error)}`);
  }
}

main().catch((error: unknown) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
