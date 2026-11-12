import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import Busboy from "busboy";
import AdmZip from "adm-zip";
import { approveStoredCriteria, proposeCriteria, readStoredCriteria, type StoredCriteria } from "./criteria-approval";
import { getPaymentRecord, paymentStatus, fundCase, refreshPayoutStatus } from "./milestone";
import { readReview, resolveReviewHandoff, timeRemaining, reviewMarkdownPath } from "./review-handoff";
import { verify } from "./verify";
import { outputRoot } from "./paths";

const port = Number(process.env.UI_PORT ?? 3000);
const host = "127.0.0.1";
const publicDirectory = path.resolve(__dirname, "..", "public");
const maxUploadBytes = 50 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9._-]+$/;
const caseRoot = (caseId: string) => path.resolve(outputRoot(), caseId);
const caseFile = (caseId: string, name: string) => path.join(caseRoot(caseId), name);

export interface UiServerOptions {
  port?: number;
  listen?: boolean;
}

function assertSandboxConfiguration(): void {
  if (process.env.PAYPAL_ENV !== "sandbox") throw new Error('UI requires PAYPAL_ENV to be exactly "sandbox".');
}

function assertCaseId(caseId: string): void {
  if (!idPattern.test(caseId)) throw new Error("Case ID may contain only letters, numbers, dots, underscores, and hyphens.");
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

async function readOptionalJson(filename: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await fs.readFile(filename, "utf8")) as Record<string, unknown>; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function listCaseIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const root of [path.resolve("testset", "cases"), outputRoot()]) {
    try {
      for (const entry of await fs.readdir(root, { withFileTypes: true })) if (entry.isDirectory() && idPattern.test(entry.name)) ids.add(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...ids].sort();
}

async function caseSummary(caseId: string): Promise<Record<string, unknown>> {
  const criteria = await readOptionalJson(caseFile(caseId, "criteria.json"));
  const payment = await readOptionalJson(caseFile(caseId, "paypal.json"));
  const result = await readOptionalJson(caseFile(caseId, "result.json"));
  const review = await readOptionalJson(caseFile(caseId, "review.json"));
  let submission = false;
  try { submission = (await fs.readdir(caseFile(caseId, "submission"))).length > 0; } catch { /* absent submission */ }
  let stage = "brief added";
  if (criteria?.status === "proposed") stage = "criteria proposed";
  if (criteria?.status === "approved") stage = "criteria approved";
  if (payment?.orderId && !payment.authorizationId) stage = "awaiting buyer approval";
  if (payment?.authorizationId) stage = "authorized";
  if (submission) stage = "submitted";
  if (result?.decision === "release") stage = "released";
  if (result?.decision === "reject") stage = "rejected";
  if (result?.decision === "escalate") stage = review?.status === "pending" ? "in review" : "needs review";
  if (payment?.milestones && Array.isArray(payment.milestones) && payment.milestones.length > 0) stage = "released";
  return { caseId, stage, criteria, payment, result, review, submission };
}

async function caseDetail(caseId: string): Promise<Record<string, unknown>> {
  assertCaseId(caseId);
  const summary = await caseSummary(caseId);
  const review = summary.review as Record<string, unknown> | undefined;
  const events: Array<{ timestamp: string; event: string; status?: string }> = [];
  const files = ["criteria.json", "paypal.json", "result.json", "review.json"];
  for (const filename of files) {
    const data = await readOptionalJson(caseFile(caseId, filename));
    if (!data) continue;
    const timestamp = String(data.approvedAt ?? data.createdAt ?? data.timestamp ?? data.escalatedAt ?? new Date(0).toISOString());
    events.push({ timestamp, event: filename.replace(".json", ""), status: typeof data.status === "string" ? data.status : typeof data.decision === "string" ? data.decision : undefined });
  }
  events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  if (review) {
    try {
      (summary.review as Record<string, unknown>).markdown = await fs.readFile(reviewMarkdownPath(caseId), "utf8");
      (summary.review as Record<string, unknown>).remaining = timeRemaining(String(review.expirationTime ?? ""));
    } catch { /* review JSON remains available when markdown is absent */ }
  }
  return { ...summary, events, buyerEmail: process.env.PAYPAL_BUYER_EMAIL ?? "not configured" };
}

function safeUploadPath(root: string, filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Upload contains a path traversal.");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Upload contains a path traversal.");
  return target;
}

async function parseUpload(request: http.IncomingMessage, caseId: string): Promise<string[]> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > maxUploadBytes) throw new Error("Upload exceeds the 50 MB limit.");
  const root = caseFile(caseId, "submission");
  const temporary = `${root}.uploading`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.mkdir(temporary, { recursive: true });
  const files: Array<{ filename: string; data: Buffer }> = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const parser = Busboy({ headers: request.headers, preservePath: true, limits: { fileSize: maxUploadBytes, files: 100 } });
    parser.on("file", (_field, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxUploadBytes) stream.destroy(new Error("Upload exceeds the 50 MB limit."));
        else chunks.push(chunk);
      });
      stream.on("limit", () => reject(new Error("Upload exceeds the 50 MB limit.")));
      stream.on("error", reject);
      stream.on("end", () =>       files.push({ filename: info.filename || "upload.bin", data: Buffer.concat(chunks) }));
    });
    parser.on("error", reject);
    parser.on("finish", resolve);
    request.pipe(parser);
  });
  const names: string[] = [];
  try {
    for (const file of files) {
      if (file.filename.toLowerCase().endsWith(".zip")) {
        const zip = new AdmZip(file.data);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const target = safeUploadPath(temporary, entry.entryName);
          const data = entry.getData();
          total += data.length;
          if (total > maxUploadBytes) throw new Error("Extracted upload exceeds the 50 MB limit.");
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, data);
          names.push(path.relative(temporary, target));
        }
      } else {
        const target = safeUploadPath(temporary, file.filename);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.data);
        names.push(path.relative(temporary, target));
      }
    }
    await fs.rm(root, { recursive: true, force: true });
    await fs.rename(temporary, root);
    return names.sort();
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function api(request: http.IncomingMessage, response: http.ServerResponse, pathname: string): Promise<void> {
  if (pathname === "/api/cases" && request.method === "GET") {
    json(response, 200, await Promise.all((await listCaseIds()).map(caseSummary)));
    return;
  }
  const match = pathname.match(/^\/api\/cases\/([^/]+)(?:\/(.*))?$/);
  if (!match) { json(response, 404, { error: "Not found." }); return; }
  const caseId = decodeURIComponent(match[1]);
  assertCaseId(caseId);
  const action = match[2] ?? "";
  if (request.method === "GET" && !action) { json(response, 200, await caseDetail(caseId)); return; }
  if (request.method === "POST" && action === "create") {
    const body = await readJson(request);
    const brief = requiredString(body, "brief");
    const stack = requiredString(body, "stack");
    if (await fs.stat(caseRoot(caseId)).then(() => true).catch(() => false) || (await listCaseIds()).includes(caseId)) throw new Error(`Case ${caseId} already exists.`);
    await fs.mkdir(caseRoot(caseId), { recursive: true });
    await fs.writeFile(caseFile(caseId, "brief.md"), brief);
    await fs.writeFile(caseFile(caseId, "manifest.json"), JSON.stringify({ stack }, null, 2));
    json(response, 201, await caseDetail(caseId));
    return;
  }
  if (request.method === "POST" && (action === "criteria" || action === "revise")) {
    const body = action === "revise" ? await readJson(request) : {};
    const brief = await fs.readFile(caseFile(caseId, "brief.md"), "utf8");
    const stackData = await readJsonFile(caseFile(caseId, "manifest.json"));
    const criteria = await proposeCriteria(caseId, `${brief}${body.note ? `\n\nClient revision note:\n${String(body.note)}` : ""}`, String(stackData.stack ?? "Node 20"));
    json(response, 200, criteria); return;
  }
  if (request.method === "POST" && (action === "criteria/approve" || action === "approve")) {
    json(response, 200, await approveStoredCriteria(caseId));
    return;
  }
  if (request.method === "POST" && action === "fund") {
    const criteria = await readStoredCriteria(caseId);
    if (criteria.status !== "approved") throw new Error("Approve criteria before creating a buyer order.");
    const body = await readJson(request);
    json(response, 200, await fundCase(caseId, requiredString(body, "amount"), requiredString(body, "currency"))); return;
  }
  if (request.method === "POST" && action === "status") { json(response, 200, await paymentStatus(caseId)); return; }
  if (request.method === "POST" && action === "upload") { json(response, 200, { files: await parseUpload(request, caseId) }); return; }
  if (request.method === "POST" && action === "verify") {
    const criteria = await readStoredCriteria(caseId);
    if (criteria.status !== "approved") throw new Error("Approve criteria before running verification.");
    const payment = await getPaymentRecord(caseId);
    if (!payment.authorizationId) throw new Error("Authorize the PayPal order before running verification.");
    const submission = caseFile(caseId, "submission");
    await fs.access(submission);
    const caseDir = await fs.stat(path.resolve("testset", "cases", caseId)).then(() => path.resolve("testset", "cases", caseId)).catch(() => caseRoot(caseId));
    json(response, 200, await verify(caseDir, submission)); return;
  }
  if (request.method === "GET" && action === "review") {
    const review = await readReview(caseId);
    json(response, 200, { ...review, markdown: await fs.readFile(reviewMarkdownPath(caseId), "utf8"), remaining: timeRemaining(review.expirationTime) }); return;
  }
  if (request.method === "POST" && action === "review") {
    const body = await readJson(request);
    const decision = requiredString(body, "decision");
    if (decision !== "release" && decision !== "reject") throw new Error("decision must be release or reject.");
    json(response, 200, await resolveReviewHandoff(caseId, decision)); return;
  }
  if (request.method === "POST" && action === "payout/refresh") { json(response, 200, await refreshPayoutStatus(caseId)); return; }
  json(response, 405, { error: "Method not allowed." });
}

async function readJsonFile(filename: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filename, "utf8")) as Record<string, unknown>;
}

async function staticFile(response: http.ServerResponse, pathname: string): Promise<void> {
  const filename = path.resolve(publicDirectory, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!filename.startsWith(`${publicDirectory}${path.sep}`)) { json(response, 403, { error: "Forbidden." }); return; }
  try {
    const content = await fs.readFile(filename);
    const type = filename.endsWith(".css") ? "text/css" : filename.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
    response.end(content);
  } catch { json(response, 404, { error: "Not found." }); }
}

export function createUiServer(options: UiServerOptions = {}): http.Server {
  if (options.listen !== false) assertSandboxConfiguration();
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    Promise.resolve(url.pathname.startsWith("/api/") ? api(request, response, url.pathname) : staticFile(response, url.pathname))
      .catch((error: unknown) => json(response, 400, { error: error instanceof Error ? error.message : String(error) }));
  });
}

export function startUiServer(): http.Server {
  assertSandboxConfiguration();
  const server = createUiServer({ listen: false, port });
  server.listen(port, host, () => console.log(`Delivery verifier UI: http://${host}:${port}`));
  return server;
}
