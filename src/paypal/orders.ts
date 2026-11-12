import crypto from "node:crypto";
import { paypalRequest, paypalRequestWithStatus } from "./client";

export interface CreatedOrder {
  orderId: string;
  approvalUrl: string;
}

export interface CreatedOrderResult {
  order: CreatedOrder;
  httpStatus: number;
  orderStatus?: string;
}

export interface CardOrderResult {
  orderId: string;
  approvalUrl?: string;
  httpStatus: number;
  orderStatus: string;
}

export interface PayPalOrder {
  id?: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string }>;
  purchase_units?: Array<{ reference_id?: string; amount?: { currency_code?: string; value?: string }; payments?: { authorizations?: Array<{ id?: string }> } }>;
  payer?: { email_address?: string };
}

export interface AuthorizationDetails {
  authorizationId?: string;
  status?: string;
  amount?: { currency_code?: string; value?: string };
  expirationTime?: string;
  raw: Record<string, unknown>;
}

export interface CardPaymentSource {
  number: string;
  expiry: string;
  security_code?: string;
  name?: string;
}

export async function createAuthorizeOrder(amount: string, currency: string, caseId: string, requestId: string = crypto.randomUUID()): Promise<CreatedOrder> {
  return (await createAuthorizeOrderWithStatus(amount, currency, caseId, requestId)).order;
}

export async function createAuthorizeOrderWithStatus(amount: string, currency: string, caseId: string, requestId: string = crypto.randomUUID()): Promise<CreatedOrderResult> {
  const result = await paypalRequestWithStatus<PayPalOrder>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
  }, requestId);
  const approvalUrl = result.value.links?.find((link) => link.rel === "approve")?.href;
  if (!result.value.id || !approvalUrl) throw new Error("PayPal sandbox order response did not include an ID and approval URL.");
  return { order: { orderId: result.value.id, approvalUrl }, httpStatus: result.status, orderStatus: result.value.status };
}

export async function createAuthorizeOrderWithCard(amount: string, currency: string, caseId: string, card: CardPaymentSource, requestId: string = crypto.randomUUID()): Promise<CardOrderResult> {
  const result = await paypalRequestWithStatus<PayPalOrder>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    payment_source: { card },
    purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
  }, requestId);
  if (!result.value.id) throw new Error("PayPal card order response did not include an ID.");
  return {
    orderId: result.value.id,
    approvalUrl: result.value.links?.find((link) => link.rel === "approve")?.href,
    httpStatus: result.status,
    orderStatus: result.value.status ?? "UNKNOWN"
  };
}

export async function getOrder(orderId: string): Promise<{ status: string; authorizationId?: string; payerEmail?: string; raw?: PayPalOrder }> {
  const result = await paypalRequest<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const authorizationId = result.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  const response: { status: string; authorizationId?: string; payerEmail?: string; raw?: PayPalOrder } = { status: result.status ?? "UNKNOWN" };
  if (authorizationId) response.authorizationId = authorizationId;
  if (result.payer?.email_address) response.payerEmail = result.payer.email_address;
  return response;
}

export async function confirmOrderWithCard(orderId: string, card: CardPaymentSource, requestId: string = crypto.randomUUID()): Promise<{ status: string; raw: PayPalOrder }> {
  const result = await paypalRequestWithStatus<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/confirm-payment-source`, {
    payment_source: { card }
  }, requestId);
  return { status: result.value.status ?? "UNKNOWN", raw: result.value };
}

export async function probeOrder(orderId: string): Promise<{ httpStatus: number; orderStatus: string }> {
  const result = await paypalRequestWithStatus<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  return { httpStatus: result.status, orderStatus: result.value.status ?? "UNKNOWN" };
}

function mapAuthorization(result: Record<string, unknown>): AuthorizationDetails {
  return {
    authorizationId: typeof result.id === "string" ? result.id : undefined,
    status: typeof result.status === "string" ? result.status : undefined,
    amount: result.amount as { currency_code?: string; value?: string } | undefined,
    expirationTime: typeof result.expiration_time === "string" ? result.expiration_time : undefined,
    raw: result
  };
}

export async function authorizeOrder(orderId: string, requestId: string = crypto.randomUUID()): Promise<AuthorizationDetails> {
  const result = await paypalRequest<Record<string, unknown>>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
  const authorization = (result.purchase_units as Array<{ payments?: { authorizations?: Array<Record<string, unknown>> } }> | undefined)?.[0]?.payments?.authorizations?.[0];
  if (!authorization?.id) throw new Error("PayPal authorize response did not include an authorization ID.");
  return mapAuthorization(authorization);
}

export async function getAuthorization(authId: string): Promise<AuthorizationDetails> {
  return mapAuthorization(await paypalRequest<Record<string, unknown>>("GET", `/v2/payments/authorizations/${encodeURIComponent(authId)}`));
}

export async function captureAuthorization(authId: string, amount: string, currency: string, requestId: string = crypto.randomUUID()): Promise<{ captureId?: string; invoiceId: string; status?: string; raw: Record<string, unknown> }> {
  const invoiceId = `milestone-${crypto.randomUUID()}`;
  const result = await paypalRequest<Record<string, unknown>>("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
    amount: { currency_code: currency, value: amount },
    invoice_id: invoiceId,
    final_capture: true
  }, requestId);
  return { captureId: typeof result.id === "string" ? result.id : undefined, invoiceId, status: typeof result.status === "string" ? result.status : undefined, raw: result };
}
