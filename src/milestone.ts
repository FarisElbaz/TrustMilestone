import fs from "node:fs/promises";
import path from "node:path";
import { validateAmount, validateCurrency, validatePaymentEnvironment } from "./paypal/config";
import { authorizeOrder, captureAuthorization, createAuthorizeOrder, getAuthorization, getOrder } from "./paypal/orders";
import { getPayout, sendPayout, voidAuthorization, waitForPayout } from "./paypal/payments";

export interface PayPalResponseRecord { operation: string; status: string; recordedAt: string }
export interface MilestoneRecord {
  number: number; amount: string; captureId?: string; invoiceId?: string; captureStatus?: string;
  payoutBatchId?: string; payoutStatus?: string; payoutItemStatuses?: string[];
  payoutNote?: string;
  status: "released" | "pending" | "failed" | "voided"; timestamp: string;
}
export interface PayPalRecord {
  caseId: string; amount: string; currency: string; createdAt: string; orderId?: string; approvalUrl?: string;
  orderStatus?: string; authorizationId?: string; authorizedAt?: string; authorizationStatus?: string;
  authorizationResponseStatus?: string; authorizationExpirationTime?: string;
  authorizationAmount?: string; authorizationCurrency?: string; milestones: MilestoneRecord[];
  voidedAt?: string; needsReview?: string; paypalResponses?: PayPalResponseRecord[];
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
  const record: PayPalRecord = { caseId, amount, currency, createdAt: new Date().toISOString(), milestones: [], paypalResponses: [] };
  if (paymentMode() === "mock") {
    record.authorizationId = `mock-auth-${caseId}`; record.authorizedAt = record.createdAt;
    record.authorizationStatus = "AUTHORIZED"; record.authorizationExpirationTime = new Date(Date.now() + 29 * 86400000).toISOString();
  } else {
    assertSandbox();
    const order = await createAuthorizeOrder(amount, currency, caseId);
    record.orderId = order.orderId; record.approvalUrl = order.approvalUrl; record.orderStatus = "CREATED";
    observe(record, "create-order", record.orderStatus, "order");
  }
  await writeRecord(record); return record;
}

export async function paymentStatus(caseId: string): Promise<PayPalRecord> {
  const record = await readRecord(caseId);
  if (paymentMode() === "mock") return record;
  assertSandbox();
  if (record.authorizationId) return record;
  if (!record.orderId) throw new Error(`No PayPal order is recorded for ${caseId}.`);
  const order = await getOrder(record.orderId);
  record.orderStatus = order.status; observe(record, "show-order", order.status, "order");
  if (order.payerEmail && process.env.PAYPAL_BUYER_EMAIL && order.payerEmail.toLowerCase() !== process.env.PAYPAL_BUYER_EMAIL.toLowerCase()) {
    await writeRecord(record); throw new Error("PayPal payer email does not match PAYPAL_BUYER_EMAIL.");
  }
  if (order.status !== "APPROVED") { await writeRecord(record); throw new Error(`PayPal order ${record.orderId} is not approved (status: ${order.status}).`); }
  const authorization = await authorizeOrder(record.orderId);
  if (!authorization.authorizationId || !authorization.expirationTime) throw new Error("PayPal authorization response did not include ID and expiration_time.");
  record.authorizationId = authorization.authorizationId; record.authorizedAt = new Date().toISOString();
  record.authorizationStatus = authorization.status ?? "UNKNOWN"; record.authorizationResponseStatus = record.authorizationStatus;
  record.authorizationExpirationTime = authorization.expirationTime;
  record.authorizationAmount = authorization.amount?.value; record.authorizationCurrency = authorization.amount?.currency_code;
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

export async function releaseMilestone(caseId: string, amount: string, milestoneNumber = 1): Promise<void> {
  const record = await requireAuthorized(caseId); validateMoney(amount, record.currency);
  if (record.milestones.some((item) => item.number === milestoneNumber)) throw new Error(`Milestone ${milestoneNumber} has already been recorded.`);
  if (record.currency !== (record.authorizationCurrency ?? record.currency)) throw new Error("Currency differs from the authorized order.");
  if (cents(record.milestones.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)) + cents(amount) > cents(record.amount)) throw new Error("Milestone total exceeds the authorized amount.");
  const item: MilestoneRecord = { number: milestoneNumber, amount, status: "pending", timestamp: new Date().toISOString() };
  if (paymentMode() === "mock") item.status = "released";
  else {
    assertSandbox();
    if (record.authorizationAmount && cents(amount) > cents(record.authorizationAmount)) throw new Error("Capture exceeds the authorized amount.");
    const capture = await captureAuthorization(record.authorizationId!, amount, record.currency);
    item.captureId = capture.captureId; item.invoiceId = capture.invoiceId; item.captureStatus = capture.status;
    if (!capture.captureId || !capture.status) throw new Error("PayPal capture response was incomplete.");
    observe(record, "capture", capture.status, "capture");
    record.milestones.push(item);
    await writeRecord(record);
    const submittedPayout = await sendPayout(caseId, process.env.PAYPAL_CONTRACTOR_EMAIL ?? "", amount, record.currency, milestoneNumber);
    if (!submittedPayout.batchId || !submittedPayout.batchStatus) throw new Error("PayPal payout response was incomplete.");
    item.payoutBatchId = submittedPayout.batchId;
    item.payoutStatus = submittedPayout.batchStatus;
    await writeRecord(record);
    const payout = await waitForPayout(submittedPayout.batchId);
    item.payoutStatus = payout.batchStatus; item.payoutItemStatuses = payout.itemStatuses;
    if (payout.itemStatuses.includes("UNCLAIMED")) item.payoutNote = "Contractor sandbox recipient has no PayPal account configured.";
    if (!payout.batchStatus) throw new Error("PayPal payout status response was incomplete.");
    observe(record, "payout", payout.batchStatus, "payout");
    item.status = "released";
    await writeRecord(record);
    return;
  }
  record.milestones.push(item); await writeRecord(record);
}

export async function rejectMilestone(caseId: string): Promise<void> {
  const record = await requireAuthorized(caseId);
  if (record.milestones.length) throw new Error("Cannot void an authorization after capture.");
  if (paymentMode() !== "mock") { assertSandbox(); await voidAuthorization(record.authorizationId!); }
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
  await writeRecord(record); return milestone.payoutStatus;
}
export interface Milestone { releaseMilestone(caseId: string, amount: string): Promise<void>; holdMilestone(caseId: string, deadline: string | Date): Promise<void>; rejectMilestone(caseId: string): Promise<void>; }
export const milestone: Milestone = { releaseMilestone, holdMilestone, rejectMilestone };
