import { PayPalApiError, paypalRequest } from "./client";

export async function voidAuthorization(authId: string): Promise<Record<string, unknown>> {
  return paypalRequest<Record<string, unknown>>("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {});
}

export interface PayoutResult {
  batchId?: string;
  batchStatus?: string;
  itemStatuses: string[];
  senderBatchId: string;
  raw: Record<string, unknown>;
}

export async function getPayout(batchId: string): Promise<{ batchStatus?: string; itemStatuses: string[]; raw: Record<string, unknown> }> {
  const result = await paypalRequest<{ batch_header?: { batch_status?: string }; items?: Array<{ transaction_status?: string }> }>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  return { batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], raw: result };
}

export async function waitForPayout(batchId: string, timeoutMs = 15 * 60 * 1000): Promise<{ batchStatus?: string; itemStatuses: string[]; raw: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payout = await getPayout(batchId);
    if (payout.batchStatus === "SUCCESS" || payout.batchStatus === "DENIED" || payout.batchStatus === "CANCELED") return payout;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`PayPal payout ${batchId} did not reach a final status within 15 minutes.`);
}

export function isPayoutNotFound(error: unknown): boolean {
  return error instanceof PayPalApiError && error.status === 404;
}

export async function sendPayout(caseId: string, contractorEmail: string, amount: string, currency: string, milestoneNumber = 1): Promise<PayoutResult> {
  if (!contractorEmail) throw new Error("Missing contractor sandbox email.");
  const senderBatchId = `${caseId}-milestone-${milestoneNumber}`.replace(/[^A-Za-z0-9._-]/g, "-");
  const result = await paypalRequest<{ batch_header?: { payout_batch_id?: string; batch_status?: string }; items?: Array<{ transaction_status?: string }> }>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: `Milestone payment for ${caseId}` },
    items: [{ recipient_type: "EMAIL", amount: { value: amount, currency }, receiver: contractorEmail, note: `Milestone ${milestoneNumber} for ${caseId}` }]
  });
  return { batchId: result.batch_header?.payout_batch_id, batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], senderBatchId, raw: result };
}
