import { paypalRequest } from "./client";

export interface BalanceSnapshot {
  capturedAt: string;
  currency: string;
  available: string;
  total: string;
  raw: Record<string, unknown>;
}

export interface TransactionRecord {
  transactionId?: string;
  eventCode?: string;
  status?: string;
  amount?: string;
  fee?: string;
  currency?: string;
  raw: Record<string, unknown>;
}

export async function getBalances(currency = "USD"): Promise<BalanceSnapshot> {
  const result = await paypalRequest<Record<string, unknown>>("GET", "/v1/reporting/balances");
  const balances = Array.isArray(result.balances) ? result.balances as Record<string, unknown>[] : [];
  const selected = balances.find((item) => item.currency === currency) ?? balances[0];
  const total = (selected?.total_balance ?? {}) as Record<string, unknown>;
  const available = (selected?.available_balance ?? {}) as Record<string, unknown>;
  if (!selected || typeof total.value !== "string" || typeof available.value !== "string") {
    throw new Error("PayPal balance response did not include a usable balance.");
  }
  return { capturedAt: new Date().toISOString(), currency: String(total.currency_code ?? currency), available: available.value, total: total.value, raw: result };
}

export async function searchTransactions(startDate: Date, endDate: Date): Promise<TransactionRecord[]> {
  const params = new URLSearchParams({ start_date: startDate.toISOString(), end_date: endDate.toISOString(), page_size: "100" });
  const result = await paypalRequest<Record<string, unknown>>("GET", `/v1/reporting/transactions?${params.toString()}`);
  const rows = Array.isArray(result.transaction_details) ? result.transaction_details as Record<string, unknown>[] : [];
  return rows.map((row) => {
    const info = (row.transaction_info ?? {}) as Record<string, unknown>;
    const amount = (info.transaction_amount ?? {}) as Record<string, unknown>;
    const fee = (info.fee_amount ?? {}) as Record<string, unknown>;
    return {
      transactionId: typeof info.transaction_id === "string" ? info.transaction_id : undefined,
      eventCode: typeof info.transaction_event_code === "string" ? info.transaction_event_code : undefined,
      status: typeof info.transaction_status === "string" ? info.transaction_status : undefined,
      amount: typeof amount.value === "string" ? amount.value : undefined,
      fee: typeof fee.value === "string" ? fee.value : undefined,
      currency: typeof amount.currency_code === "string" ? amount.currency_code : undefined,
      raw: row
    };
  });
}
