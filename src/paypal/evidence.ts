import fs from "node:fs/promises";
import path from "node:path";
import { savePaymentRecord, type PayPalRecord } from "../milestone";

export interface PaymentEvidence {
  caseId: string;
  steps?: Array<{ step: string; paypalId?: string; status: string; httpStatus?: number; balance?: unknown; error?: string }>;
  reportingErrors?: Array<{ endpoint: string; httpStatus?: number; error: string }>;
  milestones: Record<string, {
    beforeBusiness?: unknown;
    afterCaptureBusiness?: unknown;
    afterPayoutBusiness?: unknown;
    captureTransactions?: unknown[];
    payoutTransactions?: unknown[];
    contractor?: { before: string; after: string; enteredAt: string };
    checks?: Record<string, boolean>;
  }>;
  updatedAt: string;
}

const evidencePath = (caseId: string) => path.resolve("out", caseId, "evidence.json");

export async function readEvidence(caseId: string): Promise<PaymentEvidence> {
  try { return JSON.parse(await fs.readFile(evidencePath(caseId), "utf8")) as PaymentEvidence; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { caseId, milestones: {}, updatedAt: new Date().toISOString() };
  }
}

export async function writeEvidence(value: PaymentEvidence): Promise<void> {
  await fs.mkdir(path.dirname(evidencePath(value.caseId)), { recursive: true });
  value.updatedAt = new Date().toISOString();
  await fs.writeFile(evidencePath(value.caseId), JSON.stringify(value, null, 2));
}

export async function recordContractorBalances(caseId: string, milestoneNumber: number, before: string, after: string, record: PayPalRecord): Promise<PaymentEvidence> {
  const beforeValue = Number(before);
  const afterValue = Number(after);
  if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue) || afterValue < beforeValue) throw new Error("Contractor after balance must be a number greater than or equal to the before balance.");
  const evidence = await readEvidence(caseId);
  const key = String(milestoneNumber);
  const item = evidence.milestones[key] ?? {};
  item.contractor = { before, after, enteredAt: new Date().toISOString() };
  item.checks = { ...(item.checks ?? {}), contractorBalance: afterValue - beforeValue >= Number(record.milestones.find((milestone) => milestone.number === milestoneNumber)?.amount ?? 0) };
  evidence.milestones[key] = item;
  const milestone = record.milestones.find((entry) => entry.number === milestoneNumber);
  if (milestone && item.checks.contractorBalance && item.checks.captureCompleted && item.checks.payoutSuccess && item.checks.businessBalance) milestone.status = "released";
  await savePaymentRecord(record);
  await writeEvidence(evidence);
  return evidence;
}
