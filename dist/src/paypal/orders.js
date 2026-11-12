"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthorizeOrder = createAuthorizeOrder;
exports.createAuthorizeOrderWithStatus = createAuthorizeOrderWithStatus;
exports.createAuthorizeOrderWithCard = createAuthorizeOrderWithCard;
exports.getOrder = getOrder;
exports.confirmOrderWithCard = confirmOrderWithCard;
exports.probeOrder = probeOrder;
exports.authorizeOrder = authorizeOrder;
exports.getAuthorization = getAuthorization;
exports.captureAuthorization = captureAuthorization;
const node_crypto_1 = __importDefault(require("node:crypto"));
const client_1 = require("./client");
async function createAuthorizeOrder(amount, currency, caseId, requestId = node_crypto_1.default.randomUUID()) {
    return (await createAuthorizeOrderWithStatus(amount, currency, caseId, requestId)).order;
}
async function createAuthorizeOrderWithStatus(amount, currency, caseId, requestId = node_crypto_1.default.randomUUID()) {
    const result = await (0, client_1.paypalRequestWithStatus)("POST", "/v2/checkout/orders", {
        intent: "AUTHORIZE",
        purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
    }, requestId);
    const approvalUrl = result.value.links?.find((link) => link.rel === "approve")?.href;
    if (!result.value.id || !approvalUrl)
        throw new Error("PayPal sandbox order response did not include an ID and approval URL.");
    return { order: { orderId: result.value.id, approvalUrl }, httpStatus: result.status, orderStatus: result.value.status };
}
async function createAuthorizeOrderWithCard(amount, currency, caseId, card, requestId = node_crypto_1.default.randomUUID()) {
    const result = await (0, client_1.paypalRequestWithStatus)("POST", "/v2/checkout/orders", {
        intent: "AUTHORIZE",
        payment_source: { card },
        purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
    }, requestId);
    if (!result.value.id)
        throw new Error("PayPal card order response did not include an ID.");
    return {
        orderId: result.value.id,
        approvalUrl: result.value.links?.find((link) => link.rel === "approve")?.href,
        httpStatus: result.status,
        orderStatus: result.value.status ?? "UNKNOWN"
    };
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
async function confirmOrderWithCard(orderId, card, requestId = node_crypto_1.default.randomUUID()) {
    const result = await (0, client_1.paypalRequestWithStatus)("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/confirm-payment-source`, {
        payment_source: { card }
    }, requestId);
    return { status: result.value.status ?? "UNKNOWN", raw: result.value };
}
async function probeOrder(orderId) {
    const result = await (0, client_1.paypalRequestWithStatus)("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    return { httpStatus: result.status, orderStatus: result.value.status ?? "UNKNOWN" };
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
async function authorizeOrder(orderId, requestId = node_crypto_1.default.randomUUID()) {
    const result = await (0, client_1.paypalRequest)("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
    const authorization = result.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!authorization?.id)
        throw new Error("PayPal authorize response did not include an authorization ID.");
    return mapAuthorization(authorization);
}
async function getAuthorization(authId) {
    return mapAuthorization(await (0, client_1.paypalRequest)("GET", `/v2/payments/authorizations/${encodeURIComponent(authId)}`));
}
async function captureAuthorization(authId, amount, currency, requestId = node_crypto_1.default.randomUUID()) {
    const invoiceId = `milestone-${node_crypto_1.default.randomUUID()}`;
    const result = await (0, client_1.paypalRequest)("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
        amount: { currency_code: currency, value: amount },
        invoice_id: invoiceId,
        final_capture: true
    }, requestId);
    return { captureId: typeof result.id === "string" ? result.id : undefined, invoiceId, status: typeof result.status === "string" ? result.status : undefined, raw: result };
}
