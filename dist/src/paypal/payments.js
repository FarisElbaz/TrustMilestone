"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.voidAuthorization = voidAuthorization;
exports.getPayout = getPayout;
exports.waitForPayout = waitForPayout;
exports.isPayoutNotFound = isPayoutNotFound;
exports.sendPayout = sendPayout;
const client_1 = require("./client");
async function voidAuthorization(authId) {
    return (0, client_1.paypalRequest)("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {});
}
async function getPayout(batchId) {
    const result = await (0, client_1.paypalRequest)("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
    return { batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], raw: result };
}
async function waitForPayout(batchId, timeoutMs = 15 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const payout = await getPayout(batchId);
        if (payout.batchStatus === "SUCCESS" || payout.batchStatus === "DENIED" || payout.batchStatus === "CANCELED")
            return payout;
        await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    throw new Error(`PayPal payout ${batchId} did not reach a final status within 15 minutes.`);
}
function isPayoutNotFound(error) {
    return error instanceof client_1.PayPalApiError && error.status === 404;
}
async function sendPayout(caseId, contractorEmail, amount, currency, milestoneNumber = 1) {
    if (!contractorEmail)
        throw new Error("Missing contractor sandbox email.");
    const senderBatchId = `${caseId}-milestone-${milestoneNumber}`.replace(/[^A-Za-z0-9._-]/g, "-");
    const result = await (0, client_1.paypalRequest)("POST", "/v1/payments/payouts", {
        sender_batch_header: { sender_batch_id: senderBatchId, email_subject: `Milestone payment for ${caseId}` },
        items: [{ recipient_type: "EMAIL", amount: { value: amount, currency }, receiver: contractorEmail, note: `Milestone ${milestoneNumber} for ${caseId}` }]
    });
    return { batchId: result.batch_header?.payout_batch_id, batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], senderBatchId, raw: result };
}
