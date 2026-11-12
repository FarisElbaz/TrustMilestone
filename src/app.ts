import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Busboy from "busboy";
import AdmZip from "adm-zip";
import { getDatabase, now, toUser, type Role, type User, type CaseRecord } from "./database";
import { proposeCriteria, readStoredCriteria, approveStoredCriteria } from "./criteria-approval";
import { fundCase, getPaymentRecord, paymentStatus, refreshPayoutStatus } from "./milestone";
import { resolveReviewHandoff, readReview, reviewMarkdownPath, timeRemaining } from "./review-handoff";
import { verify } from "./verify";
import { readEvidence, recordContractorBalances } from "./paypal/evidence";

declare module "express-session" {
  interface SessionData { userId?: number; csrf?: string; }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const casePattern = /^[A-Za-z0-9._-]+$/;
const maxUploadBytes = 50 * 1024 * 1024;
const uploadsRoot = () => path.resolve(process.env.SUBMISSIONS_PATH ?? path.resolve("data", "submissions"));
const db = () => getDatabase();

function publicUser(user: User): Omit<User, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}
function userById(id: number): User | undefined {
  const row = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? toUser(row) : undefined;
}
function currentUser(req: Request): User {
  const user = req.session.userId ? userById(req.session.userId) : undefined;
  if (!user) throw new Error("Authentication required.");
  return user;
}
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try { req.user = currentUser(req); next(); } catch { res.status(401).json({ error: "Authentication required." }); }
}
function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) { res.status(403).json({ error: "Forbidden." }); return; }
    next();
  };
}
function validateCaseId(id: string): void {
  if (!casePattern.test(id)) throw new Error("Invalid case ID.");
}
function caseForUser(id: string, user: User): CaseRecord {
  validateCaseId(id);
  const row = db().prepare("SELECT * FROM cases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row || (user.role !== "reviewer" && Number(row.owner_id) !== user.id && Number(row.worker_id) !== user.id)) throw new Error("Case not found.");
  return { id: String(row.id), ownerId: Number(row.owner_id), workerId: Number(row.worker_id), brief: String(row.brief), stack: String(row.stack), status: String(row.status) };
}
function csrf(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && req.get("x-csrf-token") !== req.session.csrf) {
    res.status(403).json({ error: "Invalid CSRF token." }); return;
  }
  res.setHeader("x-csrf-token", req.session.csrf);
  next();
}
function rateLimit(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
    const key = `${req.ip}:${req.path}:${identity}`;
    const hit = hits.get(key);
    const current = !hit || hit.reset <= Date.now() ? { count: 0, reset: Date.now() + windowMs } : hit;
    current.count++;
    hits.set(key, current);
    if (current.count > max) { res.status(429).json({ error: "Too many requests. Try again later." }); return; }
    next();
  };
}
function jsonBody(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new Error("Request body must be an object.");
  return req.body as Record<string, unknown>;
}
function required(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}
function recordEvent(caseId: string | undefined, actorId: number | undefined, type: string, payload: unknown = {}): void {
  db().prepare("INSERT INTO events(case_id,actor_id,type,payload,created_at) VALUES(?,?,?,?,?)").run(caseId ?? null, actorId ?? null, type, JSON.stringify(payload), now());
}
async function readOptionalJson(filename: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await fs.readFile(filename, "utf8")) as Record<string, unknown>; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
function persistPayment(caseId: string, payment: unknown): void {
  const value = payment as Record<string, unknown>;
  db().prepare("INSERT INTO payments(case_id,paypal_id,kind,status,payload,created_at) VALUES(?,?,?,?,?,?)")
    .run(caseId, value.orderId ?? value.authorizationId ?? null, "paypal", String(value.authorizationStatus ?? value.orderStatus ?? "recorded"), JSON.stringify(payment), now());
}
function safeUploadPath(root: string, filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Upload contains a path traversal.");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Upload contains a path traversal.");
  return target;
}
async function upload(req: Request, caseId: string): Promise<{ files: string[]; size: number }> {
  const length = Number(req.headers["content-length"] ?? 0);
  if (length > maxUploadBytes) throw new Error("Upload exceeds the 50 MB limit.");
  const temp = path.join(uploadsRoot(), `${caseId}.uploading`);
  const root = path.join(uploadsRoot(), caseId);
  await fs.rm(temp, { recursive: true, force: true }); await fs.mkdir(temp, { recursive: true });
  let total = 0; const files: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const parser = Busboy({ headers: req.headers, preservePath: true, limits: { fileSize: maxUploadBytes, files: 100 } });
      parser.on("file", (_field, stream, info) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => { total += chunk.length; if (total > maxUploadBytes) stream.destroy(new Error("Upload exceeds the 50 MB limit.")); else chunks.push(chunk); });
        stream.on("limit", () => reject(new Error("Upload exceeds the 50 MB limit.")));
        stream.on("error", reject);
        stream.on("end", async () => {
          try {
            const filename = info.filename || "upload.bin";
            if (filename.toLowerCase().endsWith(".zip")) {
              const zip = new AdmZip(Buffer.concat(chunks));
              for (const entry of zip.getEntries()) {
                if (entry.isDirectory) continue;
                const target = safeUploadPath(temp, entry.entryName); const data = entry.getData(); total += data.length;
                if (total > maxUploadBytes) throw new Error("Extracted upload exceeds the 50 MB limit.");
                await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data); files.push(path.relative(temp, target));
              }
            } else {
              const target = safeUploadPath(temp, filename);
              await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.concat(chunks)); files.push(path.relative(temp, target));
            }
          } catch (error) { reject(error); }
        });
      });
      parser.on("error", reject); parser.on("finish", resolve); req.pipe(parser);
    });
    await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(path.dirname(root), { recursive: true }); await fs.rename(temp, root);
    return { files: files.sort(), size: total };
  } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
}

export function createApp(): express.Express {
  getDatabase();
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(session({ secret: process.env.SESSION_SECRET ?? "development-only-change-me", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86400000 } }));
  app.use(csrf);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/api/auth/signup", rateLimit(15 * 60 * 1000, 10), async (req, res, next) => {
    try {
      const body = jsonBody(req); const email = required(body, "email").toLowerCase(); const password = required(body, "password"); const name = required(body, "name"); const paypalEmail = required(body, "paypalEmail"); const role = required(body, "role") as Role;
      if (!emailPattern.test(email) || !emailPattern.test(paypalEmail)) throw new Error("A valid email address is required.");
      if (password.length < 10 || !["client", "worker", "reviewer"].includes(role)) throw new Error("Invalid password or role.");
      const hash = await bcrypt.hash(password, 12);
      const result = db().prepare("INSERT INTO users(email,name,role,paypal_email,password_hash,created_at) VALUES(?,?,?,?,?,?)").run(email, name, role, paypalEmail, hash, now());
      req.session.userId = Number(result.lastInsertRowid); recordEvent(undefined, Number(result.lastInsertRowid), "signup", { role }); res.status(201).json({ user: publicUser(userById(Number(result.lastInsertRowid))!) });
    } catch (error) { next(error); }
  });
  app.post("/api/auth/login", rateLimit(15 * 60 * 1000, 10), async (req, res, next) => {
    try {
      const email = required(jsonBody(req), "email").toLowerCase(); const password = required(jsonBody(req), "password");
      const row = db().prepare("SELECT * FROM users WHERE email = ?").get(email) as Record<string, unknown> | undefined;
      if (!row || !(await bcrypt.compare(password, String(row.password_hash)))) { res.status(401).json({ error: "Invalid email or password." }); return; }
      req.session.userId = Number(row.id); res.json({ user: publicUser(toUser(row)), csrf: req.session.csrf });
    } catch (error) { next(error); }
  });
  app.post("/api/auth/logout", requireAuth, (req, res) => req.session.destroy(() => res.status(204).end()));
  app.get("/api/auth/status", (req, res) => {
    const user = req.session.userId ? userById(req.session.userId) : undefined;
    res.json(user ? { authenticated: true, user: publicUser(user), csrf: req.session.csrf } : { authenticated: false });
  });
  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user), csrf: req.session.csrf }));
  app.get("/api/cases", requireAuth, (req, res) => {
    const query = req.user.role === "reviewer" ? "SELECT * FROM cases ORDER BY created_at DESC" : "SELECT * FROM cases WHERE owner_id = ? OR worker_id = ? ORDER BY created_at DESC";
    const rows = (req.user.role === "reviewer" ? db().prepare(query).all() : db().prepare(query).all(req.user.id, req.user.id)) as Record<string, unknown>[];
    res.json(rows.map((row) => ({ id: row.id, brief: row.brief, stack: row.stack, status: row.status, ownerId: row.owner_id, workerId: row.worker_id })));
  });
  app.post("/api/cases", requireAuth, requireRole("client"), (req, res, next) => {
    try {
      const body = jsonBody(req); const id = required(body, "id"); validateCaseId(id); const brief = required(body, "brief"); const stack = required(body, "stack"); const workerEmail = required(body, "workerEmail").toLowerCase();
      const worker = db().prepare("SELECT * FROM users WHERE email = ? AND role = 'worker'").get(workerEmail) as Record<string, unknown> | undefined;
      if (!worker) throw new Error("Assigned worker was not found.");
      db().prepare("INSERT INTO cases(id,owner_id,worker_id,brief,stack,created_at) VALUES(?,?,?,?,?,?)").run(id, req.user.id, worker.id, brief, stack, now());
      recordEvent(id, req.user.id, "case.created"); res.status(201).json({ id });
    } catch (error) { next(error); }
  });
  app.get("/api/cases/:id", requireAuth, (req, res, next) => {
    try {
      const record = caseForUser(String(req.params.id), req.user);
      const criteria = readStoredCriteria(record.id).catch(() => undefined);
      const payment = getPaymentRecord(record.id).catch(() => undefined);
      const result = readOptionalJson(path.resolve("out", record.id, "result.json"));
      const review = readOptionalJson(path.resolve("out", record.id, "review.json"));
      const evidence = readEvidence(record.id);
      Promise.all([criteria, payment, result, review, evidence]).then(([c, p, verification, reviewRecord, paymentEvidence]) => {
        const status = verification && typeof verification.decision === "string" ? verification.decision : record.status;
        const worker = userById(record.workerId);
        res.json({ ...record, status, worker: worker ? { name: worker.name, paypalEmail: worker.paypalEmail } : undefined, criteria: c, payment: p, verification, decision: verification, review: reviewRecord, evidence: paymentEvidence });
      }).catch(next);
    } catch (error) { next(error); }
  });
  app.get("/api/cases/:id/timeline", requireAuth, (req, res, next) => {
    try {
      const record = caseForUser(String(req.params.id), req.user);
      const rows = db().prepare("SELECT events.*, users.name AS actor_name FROM events LEFT JOIN users ON users.id = events.actor_id WHERE case_id = ? ORDER BY events.created_at ASC, events.id ASC").all(record.id) as Record<string, unknown>[];
      res.json(rows.map((row) => ({ id: row.id, type: row.type, actor: row.actor_name ?? undefined, createdAt: row.created_at, payload: JSON.parse(String(row.payload)) })));
    } catch (error) { next(error); }
  });
  app.get("/api/reviews/queue", requireAuth, async (req, res, next) => {
    try {
      if (req.user.role !== "reviewer") { res.status(403).json({ error: "Reviewer access required." }); return; }
      const rows = db().prepare("SELECT id FROM cases ORDER BY created_at DESC").all() as Record<string, unknown>[];
      const queue = [];
      for (const row of rows) {
        try {
          const review = await readReview(String(row.id));
          if (review.status === "pending") {
            const remaining = timeRemaining(review.expirationTime);
            queue.push({ id: row.id, decision: "escalated", expirationTime: review.expirationTime, timeRemaining: remaining.text, milliseconds: remaining.milliseconds, criteria: review.criteria });
          }
        } catch { /* Cases without a review handoff are not queue items. */ }
      }
      queue.sort((a, b) => a.milliseconds - b.milliseconds);
      res.json(queue);
    } catch (error) { next(error); }
  });
  app.post("/api/cases/:id/payout/refresh", requireAuth, async (req, res, next) => {
    try {
      const record = caseForUser(String(req.params.id), req.user);
      const status = await refreshPayoutStatus(record.id);
      const payment = await getPaymentRecord(record.id);
      const milestone = payment.milestones[payment.milestones.length - 1];
      if (milestone) db().prepare("INSERT INTO payouts(case_id,paypal_batch_id,status,payload,created_at) VALUES(?,?,?,?,?)").run(record.id, milestone.payoutBatchId ?? null, milestone.payoutStatus ?? "unknown", JSON.stringify(milestone), now());
      res.json({ status, payment, evidence: await readEvidence(record.id) });
    } catch (error) { next(error); }
  });
  app.post("/api/cases/:id/evidence/contractor", requireAuth, async (req, res, next) => {
    try {
      const record = caseForUser(String(req.params.id), req.user);
      if (req.user.id !== record.ownerId && req.user.id !== record.workerId) throw new Error("Only a case participant may record contractor balances.");
      const body = jsonBody(req);
      const evidence = await recordContractorBalances(record.id, Number(body.milestoneNumber ?? 1), required(body, "before"), required(body, "after"), await getPaymentRecord(record.id));
      res.json(evidence);
    } catch (error) { next(error); }
  });
  app.post("/api/cases/:id/upload", requireAuth, async (req, res, next) => {
    try { const record = caseForUser(String(req.params.id), req.user); if (req.user.id !== record.workerId) { res.status(403).json({ error: "Only the assigned worker may upload." }); return; } const result = await upload(req, record.id); db().prepare("INSERT INTO submissions(case_id,storage_path,size_bytes,created_at) VALUES(?,?,?,?)").run(record.id, path.join(uploadsRoot(), record.id), result.size, now()); recordEvent(record.id, req.user.id, "submission.uploaded", result); res.json(result); } catch (error) { next(error); }
  });
  app.post("/api/cases/:id/:action", requireAuth, async (req, res, next) => {
    try {
      const caseId = String(req.params.id); const record = caseForUser(caseId, req.user); const action = String(req.params.action);
      if (["criteria", "revise", "approve", "fund", "status"].includes(action) && req.user.id !== record.ownerId) throw new Error("Only the client owner may perform this action.");
      if (action === "criteria" || action === "revise") { const note = action === "revise" ? required(jsonBody(req), "note") : ""; const value = await proposeCriteria(record.id, `${record.brief}${note ? `\n\nClient revision note:\n${note}` : ""}`, record.stack); db().prepare("INSERT INTO criteria(case_id,status,payload,created_at) VALUES(?,?,?,?)").run(record.id, value.status, JSON.stringify(value), now()); recordEvent(record.id, req.user.id, action === "revise" ? "criteria.revised" : "criteria.proposed"); res.json(value); return; }
      if (action === "approve") { const value = await approveStoredCriteria(record.id, req.user.name); db().prepare("UPDATE criteria SET status='approved',approved_by=? WHERE case_id=?").run(req.user.id, record.id); recordEvent(record.id, req.user.id, "criteria.approved"); res.json(value); return; }
      if (action === "fund") { const value = jsonBody(req); const result = await fundCase(record.id, required(value, "amount"), required(value, "currency")); persistPayment(record.id, result); recordEvent(record.id, req.user.id, "payment.funded"); res.json(result); return; }
      if (action === "status") { const result = await paymentStatus(record.id, req.user.paypalEmail); persistPayment(record.id, result); res.json(result); return; }
      if (action === "verify") { if (req.user.id !== record.workerId) throw new Error("Only the assigned worker may submit verification."); const worker = userById(record.workerId); const result = await verify(path.join("testset", "cases", record.id), path.join(uploadsRoot(), record.id), { buyerEmail: userById(record.ownerId)?.paypalEmail, contractorEmail: worker?.paypalEmail }); db().prepare("INSERT INTO verifications(case_id,decision,payload,created_at) VALUES(?,?,?,?)").run(record.id, result.decision, JSON.stringify(result), now()); recordEvent(record.id, req.user.id, "verification.completed", result); res.json(result); return; }
      if (action === "payout") { const result = await refreshPayoutStatus(record.id); const payment = await getPaymentRecord(record.id); const milestone = payment.milestones[payment.milestones.length - 1]; if (milestone) db().prepare("INSERT INTO payouts(case_id,paypal_batch_id,status,payload,created_at) VALUES(?,?,?,?,?)").run(record.id, milestone.payoutBatchId ?? null, milestone.payoutStatus ?? "unknown", JSON.stringify(milestone), now()); res.json({ status: result }); return; }
      if (action === "review") { if (req.user.role !== "reviewer") { res.status(403).json({ error: "Reviewer access required." }); return; } const decision = required(jsonBody(req), "decision"); if (decision !== "release" && decision !== "reject") throw new Error("Invalid review decision."); const result = await resolveReviewHandoff(record.id, decision, req.user.name, userById(record.workerId)?.paypalEmail); db().prepare("INSERT INTO reviews(case_id,reviewer_id,status,decision,payload,created_at) VALUES(?,?,?,?,?,?)").run(record.id, req.user.id, "resolved", decision, JSON.stringify(result), now()); res.json(result); return; }
      throw new Error("Unknown action.");
    } catch (error) { next(error); }
  });
  app.use(express.static(path.resolve(__dirname, "..", "public")));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const message = error instanceof Error ? error.message : "Request failed."; res.status(message === "Case not found." ? 404 : 400).json({ error: message }); });
  return app;
}

declare global { namespace Express { interface Request { user: User; } } }
