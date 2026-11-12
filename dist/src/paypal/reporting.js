"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBalances = getBalances;
exports.searchTransactions = searchTransactions;
const client_1 = require("./client");
async function getBalances(currency = "USD") {
    const result = await (0, client_1.paypalRequest)("GET", "/v1/reporting/balances");
    const balances = Array.isArray(result.balances) ? result.balances : [];
    const selected = balances.find((item) => item.currency === currency) ?? balances[0];
    const total = (selected?.total_balance ?? {});
    const available = (selected?.available_balance ?? {});
    if (!selected || typeof total.value !== "string" || typeof available.value !== "string") {
        throw new Error("PayPal balance response did not include a usable balance.");
    }
    return { capturedAt: new Date().toISOString(), currency: String(total.currency_code ?? currency), available: available.value, total: total.value, raw: result };
}
async function searchTransactions(startDate, endDate) {
    const params = new URLSearchParams({ start_date: startDate.toISOString(), end_date: endDate.toISOString(), page_size: "100" });
    const result = await (0, client_1.paypalRequest)("GET", `/v1/reporting/transactions?${params.toString()}`);
    const rows = Array.isArray(result.transaction_details) ? result.transaction_details : [];
    return rows.map((row) => {
        const info = (row.transaction_info ?? {});
        const amount = (info.transaction_amount ?? {});
        const fee = (info.fee_amount ?? {});
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
