"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.voidAuthorization = voidAuthorization;
exports.getPayout = getPayout;
exports.isPayoutNotFound = isPayoutNotFound;
exports.sendPayout = sendPayout;
const node_crypto_1 = __importDefault(require("node:crypto"));
const client_1 = require("./client");
async function voidAuthorization(authId, requestId = node_crypto_1.default.randomUUID()) {
    return (0, client_1.paypalRequest)("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, {}, requestId);
}
async function getPayout(batchId) {
    const result = await (0, client_1.paypalRequest)("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
    return { batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], raw: result };
}
function isPayoutNotFound(error) {
    return error instanceof client_1.PayPalApiError && error.status === 404;
}
async function sendPayout(caseId, contractorEmail, amount, currency, milestoneNumber = 1, requestId = node_crypto_1.default.randomUUID()) {
    if (!contractorEmail)
        throw new Error("Missing contractor sandbox email.");
    const senderBatchId = `${caseId}-milestone-${milestoneNumber}`.replace(/[^A-Za-z0-9._-]/g, "-");
    const result = await (0, client_1.paypalRequest)("POST", "/v1/payments/payouts", {
        sender_batch_header: { sender_batch_id: senderBatchId, email_subject: `Milestone payment for ${caseId}` },
        items: [{ recipient_type: "EMAIL", amount: { value: amount, currency }, receiver: contractorEmail, note: `Milestone ${milestoneNumber} for ${caseId}` }]
    }, requestId);
    return { batchId: result.batch_header?.payout_batch_id, batchStatus: result.batch_header?.batch_status, itemStatuses: result.items?.map((item) => item.transaction_status ?? "UNKNOWN") ?? [], senderBatchId, raw: result };
}
