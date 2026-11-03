import crypto from "node:crypto";
import { paypalRequest } from "./client";

export interface CreatedOrder {
  orderId: string;
  approvalUrl: string;
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

export async function createAuthorizeOrder(amount: string, currency: string, caseId: string): Promise<CreatedOrder> {
  const result = await paypalRequest<PayPalOrder>("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: caseId, amount: { currency_code: currency, value: amount } }]
  });
  const approvalUrl = result.links?.find((link) => link.rel === "approve")?.href;
  if (!result.id || !approvalUrl) throw new Error("PayPal sandbox order response did not include an ID and approval URL.");
  return { orderId: result.id, approvalUrl };
}

export async function getOrder(orderId: string): Promise<{ status: string; authorizationId?: string; payerEmail?: string; raw?: PayPalOrder }> {
  const result = await paypalRequest<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  const authorizationId = result.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  const response: { status: string; authorizationId?: string; payerEmail?: string; raw?: PayPalOrder } = { status: result.status ?? "UNKNOWN" };
  if (authorizationId) response.authorizationId = authorizationId;
  if (result.payer?.email_address) response.payerEmail = result.payer.email_address;
  return response;
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

export async function authorizeOrder(orderId: string): Promise<AuthorizationDetails> {
  const result = await paypalRequest<Record<string, unknown>>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {});
  const authorization = (result.purchase_units as Array<{ payments?: { authorizations?: Array<Record<string, unknown>> } }> | undefined)?.[0]?.payments?.authorizations?.[0];
  if (!authorization?.id) throw new Error("PayPal authorize response did not include an authorization ID.");
  return mapAuthorization(authorization);
}

export async function getAuthorization(authId: string): Promise<AuthorizationDetails> {
  return mapAuthorization(await paypalRequest<Record<string, unknown>>("GET", `/v2/payments/authorizations/${encodeURIComponent(authId)}`));
}

export async function captureAuthorization(authId: string, amount: string, currency: string): Promise<{ captureId?: string; invoiceId: string; status?: string; raw: Record<string, unknown> }> {
  const invoiceId = `milestone-${crypto.randomUUID()}`;
  const result = await paypalRequest<Record<string, unknown>>("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, {
    amount: { currency_code: currency, value: amount },
    invoice_id: invoiceId,
    final_capture: false
  });
  return { captureId: typeof result.id === "string" ? result.id : undefined, invoiceId, status: typeof result.status === "string" ? result.status : undefined, raw: result };
}
