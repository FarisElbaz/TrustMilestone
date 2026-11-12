import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateAmount, validateCurrency, validatePaymentEnvironment } from "./paypal/config";
import { authorizeOrder, captureAuthorization, createAuthorizeOrder, getAuthorization, getOrder } from "./paypal/orders";
import { getPayout, sendPayout, voidAuthorization } from "./paypal/payments";

export interface PayPalResponseRecord { operation: string; status: string; recordedAt: string; requestId?: string }
export interface PayPalOperationRecord { operation: string; requestId: string; status: string; recordedAt: string }
export interface MilestoneRecord {
  number: number; amount: string; captureId?: string; invoiceId?: string; captureStatus?: string;
  payoutBatchId?: string; payoutStatus?: string; payoutItemStatuses?: string[];
  payoutNote?: string;
  status: "released" | "released_unverified" | "pending" | "failed" | "needs_review" | "voided"; timestamp: string;
}
export interface PayPalRecord {
  caseId: string; amount: string; currency: string; createdAt: string; orderId?: string; approvalUrl?: string;
  orderStatus?: string; authorizationId?: string; authorizedAt?: string; authorizationStatus?: string;
  authorizationResponseStatus?: string; authorizationExpirationTime?: string;
  authorizationAmount?: string; authorizationCurrency?: string; milestones: MilestoneRecord[];
  voidedAt?: string; needsReview?: string; paypalResponses?: PayPalResponseRecord[]; operations?: PayPalOperationRecord[];
  hold?: { deadline: string; recordedAt: string };
  escalation?: { deadline: string; recordedAt: string; resolvedAt?: string; decision?: "release" | "reject" };
}
const paymentMode = () => process.env.PAYMENT_MODE ?? "mock";
const recordPath = (caseId: string) => path.resolve("out", caseId, "paypal.json");
const known = {
  order: new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "COMPLETED"]),
  authorization: new Set(["CREATED", "AUTHORIZED", "PARTIALLY_CAPTURED", "CAPTURED", "VOIDED", "EXPIRED"]),
  capture: new Set(["COMPLETED", "PENDING", "REFUNDED", "PARTIALLY_REFUNDED"]),
  payout: new Set(["PENDING", "PROCESSING", "SUCCESS", "DENIED", "CANCELED"])
};
const readRecord = async (caseId: string): Promise<PayPalRecord> => {
  try {
    const record = JSON.parse(await fs.readFile(recordPath(caseId), "utf8")) as PayPalRecord;
    record.milestones ??= [];
    record.paypalResponses ??= [];
    record.operations ??= [];
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`No PayPal record exists for case ${caseId}.`);
    throw new Error(`Unable to read PayPal record for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
export async function getPaymentRecord(caseId: string): Promise<PayPalRecord> { return readRecord(caseId); }
const writeRecord = async (record: PayPalRecord) => {
  await fs.mkdir(path.dirname(recordPath(record.caseId)), { recursive: true });
  await fs.writeFile(recordPath(record.caseId), JSON.stringify(record, null, 2));
};
export async function savePaymentRecord(record: PayPalRecord): Promise<void> { await writeRecord(record); }
export async function markNeedsReview(caseId: string, reason: string): Promise<PayPalRecord> {
  const record = await readRecord(caseId);
  record.needsReview = reason;
  await writeRecord(record);
  return record;
}
const cents = (value: string) => Math.round(Number(value) * 100);
function validateMoney(amount: string, currency: string): void {
  const problems = [...validateAmount(amount), ...validateCurrency(currency).map((problem) => problem.replace("PAYPAL_CURRENCY", "currency"))];
  if (problems.length) throw new Error(problems.join("\n"));
}
function assertSandbox(): void { validatePaymentEnvironment(); }
function observe(record: PayPalRecord, operation: string, status: string, category: keyof typeof known): void {
  record.paypalResponses ??= [];
  record.paypalResponses.push({ operation, status, recordedAt: new Date().toISOString() });
  if (!known[category].has(status)) {
    record.needsReview = `Unknown PayPal ${category} status: ${status}`;
    throw new Error(record.needsReview);
  }
}
function beginOperation(record: PayPalRecord, operation: string): string {
  record.operations ??= [];
  const existing = record.operations.find((item) => item.operation === operation);
  if (existing) return existing.requestId;
  const entry = { operation, requestId: crypto.randomUUID(), status: "pending", recordedAt: new Date().toISOString() };
  record.operations.push(entry);
  return entry.requestId;
}
function finishOperation(record: PayPalRecord, operation: string, status: string): void {
  const entry = record.operations?.find((item) => item.operation === operation);
  if (entry) { entry.status = status; entry.recordedAt = new Date().toISOString(); }
}
function assertCaseId(caseId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(caseId)) throw new Error("Invalid case ID.");
}

export async function fundCase(caseId: string, amount: string, currency = process.env.PAYPAL_CURRENCY ?? "USD"): Promise<PayPalRecord> {
  assertCaseId(caseId); validateMoney(amount, currency);
  try {
    const existing = await readRecord(caseId);
    if (!existing.voidedAt && existing.milestones.length === 0) return existing;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("No PayPal record")) throw error;
  }
  const record: PayPalRecord = { caseId, amount, currency, createdAt: new Date().toISOString(), milestones: [], paypalResponses: [], operations: [] };
  if (paymentMode() === "mock") {
    record.authorizationId = `mock-auth-${caseId}`; record.authorizedAt = record.createdAt;
    record.authorizationStatus = "AUTHORIZED"; record.authorizationExpirationTime = new Date(Date.now() + 29 * 86400000).toISOString();
  } else {
    assertSandbox();
    const requestId = beginOperation(record, "create-order"); await writeRecord(record);
    const order = await createAuthorizeOrder(amount, currency, caseId, requestId);
    record.orderId = order.orderId; record.approvalUrl = order.approvalUrl; record.orderStatus = "CREATED";
    finishOperation(record, "create-order", record.orderStatus);
    observe(record, "create-order", record.orderStatus, "order");
  }
  await writeRecord(record); return record;
}

export async function paymentStatus(caseId: string, buyerEmail = process.env.PAYPAL_BUYER_EMAIL): Promise<PayPalRecord> {
  const record = await readRecord(caseId);
  if (paymentMode() === "mock") return record;
  assertSandbox();
  if (record.authorizationId) return record;
  if (!record.orderId) throw new Error(`No PayPal order is recorded for ${caseId}.`);
  const order = await getOrder(record.orderId);
  record.orderStatus = order.status; observe(record, "show-order", order.status, "order");
  if (order.payerEmail && buyerEmail && order.payerEmail.toLowerCase() !== buyerEmail.toLowerCase()) {
    await writeRecord(record); throw new Error("PayPal payer email does not match PAYPAL_BUYER_EMAIL.");
  }
  if (order.status !== "APPROVED") { await writeRecord(record); throw new Error(`PayPal order ${record.orderId} is not approved (status: ${order.status}).`); }
  const requestId = beginOperation(record, "authorize-order"); await writeRecord(record);
  const authorization = await authorizeOrder(record.orderId, requestId);
  if (!authorization.authorizationId || !authorization.expirationTime) throw new Error("PayPal authorization response did not include ID and expiration_time.");
  record.authorizationId = authorization.authorizationId; record.authorizedAt = new Date().toISOString();
  record.authorizationStatus = authorization.status ?? "UNKNOWN"; record.authorizationResponseStatus = record.authorizationStatus;
  record.authorizationExpirationTime = authorization.expirationTime;
  record.authorizationAmount = authorization.amount?.value; record.authorizationCurrency = authorization.amount?.currency_code;
  finishOperation(record, "authorize-order", record.authorizationStatus);
  observe(record, "authorize-order", record.authorizationStatus, "authorization");
  await writeRecord(record); return record;
}

async function requireAuthorized(caseId: string): Promise<PayPalRecord> {
  const record = await readRecord(caseId);
  if (record.needsReview) throw new Error(`Case ${caseId} needs review: ${record.needsReview}`);
  if (!record.authorizationId || !record.authorizedAt) throw new Error(`No recorded authorization for ${caseId}; run payment:status after buyer approval.`);
  if (record.authorizationStatus === "VOIDED") throw new Error(`Authorization for ${caseId} was voided.`);
  const expiry = record.authorizationExpirationTime ?? (paymentMode() === "mock" ? new Date(new Date(record.authorizedAt).getTime() + 29 * 86400000).toISOString() : undefined);
  if (!expiry || Date.now() >= new Date(expiry).getTime()) throw new Error(`Authorization for ${caseId} has expired.`);
  return record;
}

export async function releaseMilestone(caseId: string, amount: string, milestoneNumber = 1, contractorEmail = process.env.PAYPAL_CONTRACTOR_EMAIL): Promise<void> {
  const record = await requireAuthorized(caseId); validateMoney(amount, record.currency);
  if (record.milestones.some((item) => item.number === milestoneNumber)) throw new Error(`Milestone ${milestoneNumber} has already been recorded.`);
  if (record.currency !== (record.authorizationCurrency ?? record.currency)) throw new Error("Currency differs from the authorized order.");
  if (cents(record.milestones.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)) + cents(amount) > cents(record.amount)) throw new Error("Milestone total exceeds the authorized amount.");
  const item: MilestoneRecord = { number: milestoneNumber, amount, status: "pending", timestamp: new Date().toISOString() };
  if (paymentMode() === "mock") item.status = "released";
  else {
    assertSandbox();
    if (record.authorizationAmount && cents(amount) > cents(record.authorizationAmount)) throw new Error("Capture exceeds the authorized amount.");
    const requestId = beginOperation(record, "capture"); await writeRecord(record);
    const capture = await captureAuthorization(record.authorizationId!, amount, record.currency, requestId);
    item.captureId = capture.captureId; item.invoiceId = capture.invoiceId; item.captureStatus = capture.status;
    if (!capture.captureId || !capture.status) {
      item.status = "needs_review"; record.needsReview = "PayPal capture response was incomplete."; record.milestones.push(item); await writeRecord(record); return;
    }
    finishOperation(record, "capture", capture.status);
    record.milestones.push(item);
    await writeRecord(record);
    if (capture.status !== "COMPLETED") {
      item.status = "needs_review"; record.needsReview = `Capture returned ${capture.status}; payout was not submitted.`; await writeRecord(record); return;
    }
    observe(record, "capture", capture.status, "capture");
    await writeRecord(record);
    const payoutRequestId = beginOperation(record, "payout"); await writeRecord(record);
    const submittedPayout = await sendPayout(caseId, contractorEmail ?? "", amount, record.currency, milestoneNumber, payoutRequestId);
    if (!submittedPayout.batchId || !submittedPayout.batchStatus) throw new Error("PayPal payout response was incomplete.");
    item.payoutBatchId = submittedPayout.batchId;
    item.payoutStatus = submittedPayout.batchStatus;
    finishOperation(record, "payout", submittedPayout.batchStatus);
    await writeRecord(record);
    item.status = "released_unverified";
    await writeRecord(record);
    return;
  }
  record.milestones.push(item); await writeRecord(record);
}

export async function rejectMilestone(caseId: string): Promise<void> {
  const record = await requireAuthorized(caseId);
  if (record.milestones.length) throw new Error("Cannot void an authorization after capture.");
  if (paymentMode() !== "mock") {
    assertSandbox();
    const requestId = beginOperation(record, "void"); await writeRecord(record);
    await voidAuthorization(record.authorizationId!, requestId);
    const result = await getAuthorization(record.authorizationId!);
    const status = result.status ?? "UNKNOWN";
    finishOperation(record, "void", status); observe(record, "void", status, "authorization");
    if (status !== "VOIDED") { record.needsReview = `Void returned ${status}.`; await writeRecord(record); throw new Error(record.needsReview); }
  }
  record.authorizationStatus = "VOIDED"; record.voidedAt = new Date().toISOString(); await writeRecord(record);
}
export async function holdMilestone(caseId: string, deadline: string | Date): Promise<void> {
  const record = await requireAuthorized(caseId);
  record.escalation = { deadline: new Date(deadline).toISOString(), recordedAt: new Date().toISOString() };
  record.hold = { deadline: record.escalation.deadline, recordedAt: record.escalation.recordedAt }; await writeRecord(record);
}
export async function resolveReview(caseId: string, decision: "release" | "reject"): Promise<void> {
  const record = await requireAuthorized(caseId);
  if (!record.escalation || record.escalation.resolvedAt) throw new Error("No unresolved escalation exists for this case.");
  if (new Date(record.escalation.deadline).getTime() < Date.now()) throw new Error("The escalation deadline has expired.");
  if (decision === "release") await releaseMilestone(caseId, record.amount, 1); else await rejectMilestone(caseId);
  record.escalation = { ...record.escalation, resolvedAt: new Date().toISOString(), decision }; await writeRecord(record);
}
export async function refreshPayoutStatus(caseId: string, milestoneNumber = 1): Promise<string | undefined> {
  const record = await readRecord(caseId); const milestone = record.milestones.find((item) => item.number === milestoneNumber);
  if (!milestone?.payoutBatchId || paymentMode() === "mock") return milestone?.payoutStatus;
  const payout = await getPayout(milestone.payoutBatchId); milestone.payoutStatus = payout.batchStatus; milestone.payoutItemStatuses = payout.itemStatuses;
  if (payout.batchStatus) observe(record, "payout-status", payout.batchStatus, "payout");
  if (payout.itemStatuses.includes("UNCLAIMED")) milestone.payoutNote = "Contractor sandbox recipient has no PayPal account configured.";
  if (payout.itemStatuses.includes("SUCCESS") && payout.batchStatus === "SUCCESS") milestone.status = "released_unverified";
  await writeRecord(record); return milestone.payoutStatus;
}
export interface Milestone { releaseMilestone(caseId: string, amount: string): Promise<void>; holdMilestone(caseId: string, deadline: string | Date): Promise<void>; rejectMilestone(caseId: string): Promise<void>; }
export const milestone: Milestone = { releaseMilestone, holdMilestone, rejectMilestone };
