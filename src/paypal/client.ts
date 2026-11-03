import crypto from "node:crypto";
import { loadEnvironment } from "../env";

loadEnvironment();

export const PAYPAL_BASE_URL = (process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").trim().replace(/\/+$/, "");
let tokenCache: { accessToken: string; expiresAt: number } | undefined;

export class PayPalApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`PayPal sandbox request failed (${status}): ${body}`);
  }
}

function credentials(): { clientId: string; clientSecret: string } {
  if (process.env.PAYPAL_ENV !== "sandbox") throw new Error('PayPal is disabled: PAYPAL_ENV must be "sandbox".');
  if (PAYPAL_BASE_URL !== "https://api-m.sandbox.paypal.com") throw new Error("PAYPAL_API_BASE must be https://api-m.sandbox.paypal.com in sandbox mode.");
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Missing PayPal sandbox credentials.");
  return { clientId, clientSecret };
}

function safeError(status: number, body: string): Error {
  if (status === 401) return new Error("PayPal sandbox client authentication failed. Use the REST app Client ID and Secret from the same PayPal Developer Sandbox app, and regenerate the Secret if needed.");
  return new PayPalApiError(status, body.replace(/Bearer\s+\S+/gi, "******").replace(/(client_secret|access_token|client_id)["'=:\s]+[^,\s}]+/gi, "$1=[redacted]"));
}

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.accessToken;
  const { clientId, clientSecret } = credentials();
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });
  const body = await response.text();
  if (!response.ok) throw safeError(response.status, body);
  const parsed = JSON.parse(body) as { access_token?: string; expires_in?: number };
  if (!parsed.access_token || !parsed.expires_in) throw new Error("PayPal sandbox returned an invalid access token response.");
  tokenCache = { accessToken: parsed.access_token, expiresAt: now + parsed.expires_in * 1000 };
  return parsed.access_token;
}

export function resetPayPalTokenCache(): void { tokenCache = undefined; }

export async function paypalRequest<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
  if (!endpoint.startsWith("/")) throw new Error("PayPal endpoint must be relative to the sandbox host.");
  const token = await accessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["PayPal-Request-Id"] = crypto.randomUUID();
  const response = await fetch(`${PAYPAL_BASE_URL}${endpoint}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseBody = await response.text();
  if (!response.ok) throw safeError(response.status, responseBody);
  return responseBody ? JSON.parse(responseBody) as T : {} as T;
}
