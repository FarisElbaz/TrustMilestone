import fs from "node:fs/promises";
import path from "node:path";
import { savePaymentRecord, type PayPalRecord } from "../milestone";
import { getBalances } from "./reporting";
import { PayPalApiError } from "./client";
import { outputRoot } from "../paths";

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
  moneyChecks?: {
    businessBalanceAfterRelease?: {
      verified: boolean;
      httpStatus?: number;
      total?: string;
      currency?: string;
      message?: string;
      capturedAt?: string;
      available?: string;
    };
  };
  updatedAt: string;
}

const evidencePath = (caseId: string) => path.resolve(outputRoot(), caseId, "evidence.json");

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

export async function checkBusinessBalance(
  caseId: string,
  currency = "USD"
): Promise<{ verified: boolean; message?: string; total?: string; currency?: string }> {
  const caseFolder = path.resolve(outputRoot(), caseId);
  try {
    await fs.mkdir(caseFolder, { recursive: true });
  } catch {
    // ignore
  }

  try {
    const snapshot = await getBalances(currency);
    const evidence = await readEvidence(caseId);
    evidence.moneyChecks ??= {};
    evidence.moneyChecks.businessBalanceAfterRelease = {
      verified: true,
      httpStatus: 200,
      total: snapshot.total,
      currency: snapshot.currency,
      available: snapshot.available,
      capturedAt: snapshot.capturedAt
    };
    await writeEvidence(evidence);
    return { verified: true, total: snapshot.total, currency: snapshot.currency };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      await fs.mkdir(caseFolder, { recursive: true });
      try {
        const snapshot = await getBalances(currency);
        const evidence = await readEvidence(caseId);
        evidence.moneyChecks ??= {};
        evidence.moneyChecks.businessBalanceAfterRelease = {
          verified: true,
          httpStatus: 200,
          total: snapshot.total,
          currency: snapshot.currency,
          available: snapshot.available,
          capturedAt: snapshot.capturedAt
        };
        await writeEvidence(evidence);
        return { verified: true, total: snapshot.total, currency: snapshot.currency };
      } catch (retryError: any) {
        error = retryError;
      }
    }

    const status = error instanceof PayPalApiError
      ? error.status
      : (error?.status ?? (error?.message?.includes("403") ? 403 : error?.message?.includes("404") ? 404 : undefined));

    let message: string;
    if (status === 403 || status === 404 || error?.message?.includes("insufficient permissions") || error?.message?.includes("NOT_AUTHORIZED")) {
      message = "Balance not verified: PayPal reporting permission not granted";
    } else {
      message = `Balance not verified: ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      const evidence: PaymentEvidence = await readEvidence(caseId).catch((): PaymentEvidence => ({ caseId, milestones: {}, updatedAt: new Date().toISOString() }));
      evidence.moneyChecks ??= {};
      evidence.moneyChecks.businessBalanceAfterRelease = {
        verified: false,
        httpStatus: status ?? 403,
        message
      };
      await writeEvidence(evidence);
    } catch {
      // do not block the rest of the flow
    }

    return { verified: false, message };
  }
}

