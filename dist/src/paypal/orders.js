"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthorizeOrder = createAuthorizeOrder;
exports.getOrder = getOrder;
exports.authorizeOrder = authorizeOrder;
exports.getAuthorization = getAuthorization;
exports.captureAuthorization = captureAuthorization;
const node_crypto_1 = __importDefault(require("node:crypto"));
const client_1 = require("./client");
async function createAuthorizeOrder(amount, currency, caseId) {
    const result = await (0, client_1.paypalRequest)("POST", "/v2/checkout/orders", {
        intent: "AUTHORIZE",
        purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
    });
    const approvalUrl = result.links?.find((link) => link.rel === "approve")?.href;
    if (!result.id || !approvalUrl)
        throw new Error("PayPal sandbox order response did not include an ID and approval URL.");
    return { orderId: result.id, approvalUrl };
}
async function getOrder(orderId) {
    const result = await (0, client_1.paypalRequest)("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    const authorizationId = result.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    const response = { status: result.status ?? "UNKNOWN" };
    if (authorizationId)
        response.authorizationId = authorizationId;
    if (result.payer?.email_address)
        response.payerEmail = result.payer.email_address;
    return response;
}
function mapAuthorization(result) {
    return {
        authorizationId: typeof result.id === "string" ? result.id : undefined,
        status: typeof result.status === "string" ? result.status : undefined,
        amount: result.amount,
        expirationTime: typeof result.expiration_time === "string" ? result.expiration_time : undefined,
        raw: result
    };
}
async function authorizeOrder(orderId) {
    const result = await (0, client_1.paypalRequest)("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {});
    const authorization = result.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!authorization?.id)
        throw new Error("PayPal authorize response did not include an authorization ID.");
    return mapAuthorization(authorization);
}
async function getAuthorization(authId) {
    return mapAuthorization(await (0, client_1.paypalRequest)("GET", `/v2/payments/authorizations/${encodeURIComponent(authId)}`));
}
async function captureAuthorization(authId, amount, currency) {
    const invoiceId = `milestone-${node_crypto_1.default.randomUUID()}`;
    const result = await (0, client_1.paypalRequest)("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
        amount: { currency_code: currency, value: amount },
        invoice_id: invoiceId,
        final_capture: false
    });
    return { captureId: typeof result.id === "string" ? result.id : undefined, invoiceId, status: typeof result.status === "string" ? result.status : undefined, raw: result };
}
