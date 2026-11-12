"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const helmet_1 = __importDefault(require("helmet"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const busboy_1 = __importDefault(require("busboy"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const database_1 = require("./database");
const criteria_approval_1 = require("./criteria-approval");
const milestone_1 = require("./milestone");
const review_handoff_1 = require("./review-handoff");
const verify_1 = require("./verify");
const evidence_1 = require("./paypal/evidence");
const paths_1 = require("./paths");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const casePattern = /^[A-Za-z0-9._-]+$/;
const maxUploadBytes = 50 * 1024 * 1024;
const uploadsRoot = () => node_path_1.default.resolve(process.env.SUBMISSIONS_PATH ?? node_path_1.default.resolve("data", "submissions"));
const db = () => (0, database_1.getDatabase)();
function publicUser(user) {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
}
function userById(id) {
    const row = db().prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? (0, database_1.toUser)(row) : undefined;
}
function currentUser(req) {
    const user = req.session.userId ? userById(req.session.userId) : undefined;
    if (!user)
        throw new Error("Authentication required.");
    return user;
}
function requireAuth(req, res, next) {
    try {
        req.user = currentUser(req);
        next();
    }
    catch {
        res.status(401).json({ error: "Authentication required." });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            res.status(403).json({ error: "Forbidden." });
            return;
        }
        next();
    };
}
function validateCaseId(id) {
    if (!casePattern.test(id))
        throw new Error("Invalid case ID.");
}
function caseForUser(id, user) {
    validateCaseId(id);
    const row = db().prepare("SELECT * FROM cases WHERE id = ?").get(id);
    if (!row || (Number(row.owner_id) !== user.id && Number(row.worker_id) !== user.id))
        throw new Error("Case not found.");
    return { id: String(row.id), ownerId: Number(row.owner_id), workerId: Number(row.worker_id), brief: String(row.brief), stack: String(row.stack), status: String(row.status) };
}
function csrf(req, res, next) {
    if (!req.session.csrf)
        req.session.csrf = node_crypto_1.default.randomBytes(24).toString("hex");
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && req.get("x-csrf-token") !== req.session.csrf) {
        res.status(403).json({ error: "Invalid CSRF token." });
        return;
    }
    res.setHeader("x-csrf-token", req.session.csrf);
    next();
}
function rateLimit(windowMs, max) {
    const hits = new Map();
    return (req, res, next) => {
        const identity = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "";
        const key = `${req.ip}:${req.path}:${identity}`;
        const hit = hits.get(key);
        const current = !hit || hit.reset <= Date.now() ? { count: 0, reset: Date.now() + windowMs } : hit;
        current.count++;
        hits.set(key, current);
        if (current.count > max) {
            res.status(429).json({ error: "Too many requests. Try again later." });
            return;
        }
        next();
    };
}
function jsonBody(req) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
        throw new Error("Request body must be an object.");
    return req.body;
}
function required(body, key) {
    const value = body[key];
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${key} is required.`);
    return value.trim();
}
function recordEvent(caseId, actorId, type, payload = {}) {
    db().prepare("INSERT INTO events(case_id,actor_id,type,payload,created_at) VALUES(?,?,?,?,?)").run(caseId ?? null, actorId ?? null, type, JSON.stringify(payload), (0, database_1.now)());
}
async function readOptionalJson(filename) {
    try {
        return JSON.parse(await promises_1.default.readFile(filename, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function persistPayment(caseId, payment) {
    const value = payment;
    db().prepare("INSERT INTO payments(case_id,paypal_id,kind,status,payload,created_at) VALUES(?,?,?,?,?,?)")
        .run(caseId, value.orderId ?? value.authorizationId ?? null, "paypal", String(value.authorizationStatus ?? value.orderStatus ?? "recorded"), JSON.stringify(payment), (0, database_1.now)());
}
function safeUploadPath(root, filename) {
    const normalized = filename.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").includes(".."))
        throw new Error("Upload contains a path traversal.");
    const target = node_path_1.default.resolve(root, normalized);
    if (target !== root && !target.startsWith(`${root}${node_path_1.default.sep}`))
        throw new Error("Upload contains a path traversal.");
    return target;
}
async function upload(req, caseId) {
    const length = Number(req.headers["content-length"] ?? 0);
    if (length > maxUploadBytes)
        throw new Error("Upload exceeds the 50 MB limit.");
    const temp = node_path_1.default.join(uploadsRoot(), `${caseId}.uploading`);
    const root = node_path_1.default.join(uploadsRoot(), caseId);
    await promises_1.default.rm(temp, { recursive: true, force: true });
    await promises_1.default.mkdir(temp, { recursive: true });
    let total = 0;
    const files = [];
    const writeStreams = [];
    const writePromises = [];
    const writeWithStream = async (target, data) => {
        await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
        const ws = (0, node_fs_1.createWriteStream)(target);
        writeStreams.push(ws);
        const promise = new Promise((resolveWs, rejectWs) => {
            let finishFired = false;
            let closeFired = false;
            const check = () => {
                if (finishFired && (closeFired || ws.closed)) {
                    resolveWs();
                }
            };
            ws.on("finish", () => {
                finishFired = true;
                check();
            });
            ws.on("close", () => {
                closeFired = true;
                check();
            });
            ws.on("error", rejectWs);
        });
        writePromises.push(promise);
        ws.end(data);
        await promise;
    };
    try {
        let pendingFileHandlers = 0;
        let parserFinished = false;
        await new Promise((resolve, reject) => {
            let settled = false;
            const fail = (err) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };
            const checkDone = () => {
                if (!settled && parserFinished && pendingFileHandlers === 0) {
                    settled = true;
                    resolve();
                }
            };
            const parser = (0, busboy_1.default)({ headers: req.headers, preservePath: true, limits: { fileSize: maxUploadBytes, files: 100 } });
            parser.on("file", (_field, stream, info) => {
                pendingFileHandlers++;
                const chunks = [];
                stream.on("data", (chunk) => {
                    total += chunk.length;
                    if (total > maxUploadBytes)
                        stream.destroy(new Error("Upload exceeds the 50 MB limit."));
                    else
                        chunks.push(chunk);
                });
                stream.on("limit", () => fail(new Error("Upload exceeds the 50 MB limit.")));
                stream.on("error", (err) => fail(err));
                stream.on("end", async () => {
                    try {
                        const filename = info.filename || "upload.bin";
                        if (filename.toLowerCase().endsWith(".zip")) {
                            const zip = new adm_zip_1.default(Buffer.concat(chunks));
                            for (const entry of zip.getEntries()) {
                                if (entry.isDirectory)
                                    continue;
                                const target = safeUploadPath(temp, entry.entryName);
                                const data = entry.getData();
                                total += data.length;
                                if (total > maxUploadBytes)
                                    throw new Error("Extracted upload exceeds the 50 MB limit.");
                                await writeWithStream(target, data);
                                files.push(node_path_1.default.relative(temp, target));
                            }
                        }
                        else {
                            const target = safeUploadPath(temp, filename);
                            await writeWithStream(target, Buffer.concat(chunks));
                            files.push(node_path_1.default.relative(temp, target));
                        }
                    }
                    catch (error) {
                        fail(error);
                    }
                    finally {
                        pendingFileHandlers--;
                        checkDone();
                    }
                });
            });
            parser.on("error", (err) => fail(err));
            parser.on("finish", () => {
                parserFinished = true;
                checkDone();
            });
            req.on("error", (err) => fail(err));
            req.pipe(parser);
        });
        // Make sure every write stream is closed and its finish event has fired before the rename. Await each stream's completion.
        await Promise.all(writePromises);
        for (const ws of writeStreams) {
            if (!ws.closed) {
                await new Promise((resolveWs, rejectWs) => {
                    let finishFired = ws.writableEnded;
                    let closeFired = ws.closed;
                    const check = () => {
                        if (finishFired && (closeFired || ws.closed))
                            resolveWs();
                    };
                    ws.on("finish", () => {
                        finishFired = true;
                        check();
                    });
                    ws.on("close", () => {
                        closeFired = true;
                        check();
                    });
                    ws.on("error", rejectWs);
                    if (ws.closed)
                        resolveWs();
                });
            }
        }
        await promises_1.default.rm(root, { recursive: true, force: true });
        await promises_1.default.mkdir(node_path_1.default.dirname(root), { recursive: true });
        try {
            await promises_1.default.rename(temp, root);
        }
        catch (error) {
            const err = error;
            if (err.code === "EPERM" || err.message?.includes("EPERM")) {
                console.warn(`[upload] fs.rename failed with EPERM; falling back to fs.cp from ${temp} to ${root}`);
                await promises_1.default.mkdir(root, { recursive: true });
                await promises_1.default.cp(temp, root, { recursive: true });
                await promises_1.default.rm(temp, { recursive: true, force: true });
            }
            else {
                throw error;
            }
        }
        return { files: files.sort(), size: total };
    }
    catch (error) {
        for (const ws of writeStreams) {
            if (!ws.closed) {
                try {
                    ws.destroy();
                }
                catch { }
            }
        }
        await promises_1.default.rm(temp, { recursive: true, force: true });
        throw error;
    }
}
function createApp() {
    (0, database_1.getDatabase)();
    const app = (0, express_1.default)();
    app.set("trust proxy", 1);
    app.use((0, helmet_1.default)());
    app.use(express_1.default.json({ limit: "1mb" }));
    app.use((0, express_session_1.default)({ secret: process.env.SESSION_SECRET ?? "development-only-change-me", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 86400000 } }));
    app.use(csrf);
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    app.post("/api/auth/signup", rateLimit(15 * 60 * 1000, 10), async (req, res, next) => {
        try {
            const body = jsonBody(req);
            const email = required(body, "email").toLowerCase();
            const password = required(body, "password");
            const name = required(body, "name");
            const paypalEmail = required(body, "paypalEmail");
            const role = required(body, "role");
            if (!emailPattern.test(email) || !emailPattern.test(paypalEmail))
                throw new Error("A valid email address is required.");
            if (password.length < 10 || !["client", "worker"].includes(role))
                throw new Error("Invalid password or role.");
            const hash = await bcryptjs_1.default.hash(password, 12);
            const result = db().prepare("INSERT INTO users(email,name,role,paypal_email,password_hash,created_at) VALUES(?,?,?,?,?,?)").run(email, name, role, paypalEmail, hash, (0, database_1.now)());
            req.session.userId = Number(result.lastInsertRowid);
            recordEvent(undefined, Number(result.lastInsertRowid), "signup", { role });
            res.status(201).json({ user: publicUser(userById(Number(result.lastInsertRowid))) });
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/auth/login", rateLimit(15 * 60 * 1000, 10), async (req, res, next) => {
        try {
            const email = required(jsonBody(req), "email").toLowerCase();
            const password = required(jsonBody(req), "password");
            const row = db().prepare("SELECT * FROM users WHERE email = ?").get(email);
            if (!row || !(await bcryptjs_1.default.compare(password, String(row.password_hash)))) {
                res.status(401).json({ error: "Invalid email or password." });
                return;
            }
            req.session.userId = Number(row.id);
            res.json({ user: publicUser((0, database_1.toUser)(row)), csrf: req.session.csrf });
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/auth/logout", requireAuth, (req, res) => req.session.destroy(() => res.status(204).end()));
    app.get("/api/auth/status", (req, res) => {
        const user = req.session.userId ? userById(req.session.userId) : undefined;
        res.json(user ? { authenticated: true, user: publicUser(user), csrf: req.session.csrf } : { authenticated: false });
    });
    app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user), csrf: req.session.csrf }));
    app.get("/api/cases", requireAuth, (req, res) => {
        const rows = db().prepare("SELECT * FROM cases WHERE owner_id = ? OR worker_id = ? ORDER BY created_at DESC").all(req.user.id, req.user.id);
        res.json(rows.map((row) => ({ id: row.id, brief: row.brief, stack: row.stack, status: row.status, ownerId: row.owner_id, workerId: row.worker_id })));
    });
    app.get("/api/templates", async (_req, res, next) => {
        try {
            const base = node_path_1.default.resolve("testset", "cases");
            const entries = await promises_1.default.readdir(base, { withFileTypes: true });
            const templates = await Promise.all(entries
                .filter((e) => e.isDirectory() && /^c\d+$/.test(e.name))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(async (e) => {
                let brief = "";
                try {
                    brief = await promises_1.default.readFile(node_path_1.default.join(base, e.name, "brief.md"), "utf8");
                }
                catch { /* ignore */ }
                return { id: e.name, label: brief.split("\n")[0].trim() || e.name, brief };
            }));
            res.json(templates);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases", requireAuth, requireRole("client"), async (req, res, next) => {
        try {
            const body = jsonBody(req);
            const id = required(body, "id");
            validateCaseId(id);
            const brief = required(body, "brief");
            const stack = required(body, "stack");
            const workerEmail = required(body, "workerEmail").toLowerCase();
            const templateId = typeof body.templateId === "string" ? body.templateId.trim() : "";
            if (!templateId)
                throw new Error("templateId is required.");
            const worker = db().prepare("SELECT * FROM users WHERE email = ? AND role = 'worker'").get(workerEmail);
            if (!worker)
                throw new Error("Assigned worker was not found.");
            // Validate template exists and copy tests/ + manifest.json into out/<id>/
            const tmplPath = node_path_1.default.resolve("testset", "cases", templateId);
            try {
                await promises_1.default.stat(tmplPath);
            }
            catch {
                throw new Error(`Template "${templateId}" was not found in testset/cases/.`);
            }
            const outDir = node_path_1.default.resolve((0, paths_1.outputRoot)(), id);
            // Never adopt files left by an earlier case with the same ID (old criteria, payments, results).
            if (db().prepare("SELECT 1 FROM cases WHERE lower(id) = lower(?)").get(id))
                throw new Error(`Case ID "${id}" is already taken. Choose a different ID.`);
            if (await promises_1.default.stat(outDir).then(() => true).catch(() => false))
                throw new Error(`Case ID "${id}" was used before and still has saved files. Choose a different ID.`);
            await promises_1.default.mkdir(outDir, { recursive: true });
            // Copy tests from template: prefer top-level tests/, fall back to reference/tests/
            const testsSource = await promises_1.default.stat(node_path_1.default.join(tmplPath, "tests")).then(() => node_path_1.default.join(tmplPath, "tests")).catch(() => node_path_1.default.join(tmplPath, "reference", "tests"));
            await promises_1.default.cp(testsSource, node_path_1.default.join(outDir, "tests"), { recursive: true });
            await promises_1.default.copyFile(node_path_1.default.join(tmplPath, "manifest.json"), node_path_1.default.join(outDir, "manifest.json"));
            await promises_1.default.writeFile(node_path_1.default.join(outDir, "brief.md"), brief);
            await promises_1.default.writeFile(node_path_1.default.join(outDir, "case-record.json"), JSON.stringify({ id, templateId, createdAt: (0, database_1.now)() }, null, 2));
            db().prepare("INSERT INTO cases(id,owner_id,worker_id,brief,stack,created_at) VALUES(?,?,?,?,?,?)").run(id, req.user.id, worker.id, brief, stack, (0, database_1.now)());
            recordEvent(id, req.user.id, "case.created", { templateId });
            res.status(201).json({ id, templateId });
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/cases/:id", requireAuth, (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            const criteria = (0, criteria_approval_1.readStoredCriteria)(record.id).catch(() => undefined);
            const payment = (0, milestone_1.getPaymentRecord)(record.id).catch(() => undefined);
            const result = readOptionalJson(node_path_1.default.resolve((0, paths_1.outputRoot)(), record.id, "result.json"));
            const review = readOptionalJson(node_path_1.default.resolve((0, paths_1.outputRoot)(), record.id, "review.json"));
            const evidence = (0, evidence_1.readEvidence)(record.id);
            Promise.all([criteria, payment, result, review, evidence]).then(([c, p, verification, reviewRecord, paymentEvidence]) => {
                const status = verification && typeof verification.decision === "string" ? verification.decision : record.status;
                const worker = userById(record.workerId);
                res.json({ ...record, status, worker: worker ? { name: worker.name, paypalEmail: worker.paypalEmail } : undefined, criteria: c, payment: p, verification, decision: verification, review: reviewRecord, evidence: paymentEvidence });
            }).catch(next);
        }
        catch (error) {
            next(error);
        }
    });
    app.get("/api/cases/:id/timeline", requireAuth, (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            const rows = db().prepare("SELECT events.*, users.name AS actor_name FROM events LEFT JOIN users ON users.id = events.actor_id WHERE case_id = ? ORDER BY events.created_at ASC, events.id ASC").all(record.id);
            res.json(rows.map((row) => ({ id: row.id, type: row.type, actor: row.actor_name ?? undefined, createdAt: row.created_at, payload: JSON.parse(String(row.payload)) })));
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases/:id/payout/refresh", requireAuth, async (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            const status = await (0, milestone_1.refreshPayoutStatus)(record.id);
            const payment = await (0, milestone_1.getPaymentRecord)(record.id);
            const milestone = payment.milestones[payment.milestones.length - 1];
            if (milestone)
                db().prepare("INSERT INTO payouts(case_id,paypal_batch_id,status,payload,created_at) VALUES(?,?,?,?,?)").run(record.id, milestone.payoutBatchId ?? null, milestone.payoutStatus ?? "unknown", JSON.stringify(milestone), (0, database_1.now)());
            try {
                await (0, evidence_1.checkBusinessBalance)(record.id);
            }
            catch { /* do not block the rest of the flow */ }
            res.json({ status, payment, evidence: await (0, evidence_1.readEvidence)(record.id) });
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases/:id/balance", requireAuth, async (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            const balance = await (0, evidence_1.checkBusinessBalance)(record.id);
            res.json({ balance, evidence: await (0, evidence_1.readEvidence)(record.id) });
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases/:id/evidence/contractor", requireAuth, async (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            if (req.user.id !== record.ownerId && req.user.id !== record.workerId)
                throw new Error("Only a case participant may record contractor balances.");
            const body = jsonBody(req);
            const evidence = await (0, evidence_1.recordContractorBalances)(record.id, Number(body.milestoneNumber ?? 1), required(body, "before"), required(body, "after"), await (0, milestone_1.getPaymentRecord)(record.id));
            res.json(evidence);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases/:id/upload", requireAuth, async (req, res, next) => {
        try {
            const record = caseForUser(String(req.params.id), req.user);
            if (req.user.id !== record.workerId) {
                res.status(403).json({ error: "Only the assigned worker may upload." });
                return;
            }
            const result = await upload(req, record.id);
            db().prepare("INSERT INTO submissions(case_id,storage_path,size_bytes,created_at) VALUES(?,?,?,?)").run(record.id, node_path_1.default.join(uploadsRoot(), record.id), result.size, (0, database_1.now)());
            recordEvent(record.id, req.user.id, "submission.uploaded", result);
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    app.post("/api/cases/:id/:action", requireAuth, async (req, res, next) => {
        try {
            const caseId = String(req.params.id);
            const record = caseForUser(caseId, req.user);
            const action = String(req.params.action);
            if (["criteria", "revise", "approve", "fund", "status"].includes(action) && req.user.id !== record.ownerId)
                throw new Error("Only the client owner may perform this action.");
            if (action === "criteria" || action === "revise") {
                const note = action === "revise" ? required(jsonBody(req), "note") : "";
                const value = await (0, criteria_approval_1.proposeCriteria)(record.id, `${record.brief}${note ? `\n\nClient revision note:\n${note}` : ""}`, record.stack);
                db().prepare("INSERT INTO criteria(case_id,status,payload,created_at) VALUES(?,?,?,?)").run(record.id, value.status, JSON.stringify(value), (0, database_1.now)());
                recordEvent(record.id, req.user.id, action === "revise" ? "criteria.revised" : "criteria.proposed");
                res.json(value);
                return;
            }
            if (action === "approve") {
                const value = await (0, criteria_approval_1.approveStoredCriteria)(record.id, req.user.name);
                db().prepare("UPDATE criteria SET status='approved',approved_by=? WHERE case_id=?").run(req.user.id, record.id);
                recordEvent(record.id, req.user.id, "criteria.approved");
                res.json(value);
                return;
            }
            if (action === "fund") {
                const value = jsonBody(req);
                const amount = required(value, "amount");
                const currency = typeof value.currency === "string" ? value.currency : (process.env.PAYPAL_CURRENCY ?? "USD");
                const method = value.method === "manual" ? "manual" : "card";
                // Guard: criteria must be approved
                const criteria = await (0, criteria_approval_1.readStoredCriteria)(record.id).catch(() => undefined);
                if (!criteria || criteria.status !== "approved") {
                    res.status(400).json({ error: "Criteria must be approved before funding." });
                    return;
                }
                // Guard: refuse a second authorization for a case that already has one
                const payment = await (0, milestone_1.getPaymentRecord)(record.id).catch(() => undefined);
                if (payment && payment.authorizationId && payment.authorizationStatus !== "VOIDED") {
                    res.status(400).json({ error: "Case already has an authorization." });
                    return;
                }
                const result = await (0, milestone_1.fundCase)(record.id, amount, currency, method);
                persistPayment(record.id, result);
                recordEvent(record.id, req.user.id, "payment.funded", { method });
                res.json(result);
                return;
            }
            if (action === "status") {
                const result = await (0, milestone_1.paymentStatus)(record.id, req.user.paypalEmail);
                persistPayment(record.id, result);
                res.json(result);
                return;
            }
            if (action === "verify") {
                if (req.user.id !== record.workerId)
                    throw new Error("Only the assigned worker may submit verification.");
                const worker = userById(record.workerId);
                // caseDirFor: prefer out/<id> if it has tests (new template-based case), otherwise fall back to testset/cases/<id>
                const outCaseDir = node_path_1.default.resolve((0, paths_1.outputRoot)(), record.id);
                const testsetCaseDir = node_path_1.default.resolve("testset", "cases", record.id);
                let caseDir;
                try {
                    await promises_1.default.access(node_path_1.default.join(outCaseDir, "tests"));
                    caseDir = outCaseDir;
                }
                catch {
                    caseDir = testsetCaseDir;
                }
                const result = await (0, verify_1.verify)(caseDir, node_path_1.default.join(uploadsRoot(), record.id), { buyerEmail: userById(record.ownerId)?.paypalEmail, contractorEmail: worker?.paypalEmail });
                db().prepare("INSERT INTO verifications(case_id,decision,payload,created_at) VALUES(?,?,?,?)").run(record.id, result.decision, JSON.stringify(result), (0, database_1.now)());
                recordEvent(record.id, req.user.id, "verification.completed", result);
                res.json(result);
                return;
            }
            if (action === "payout") {
                const result = await (0, milestone_1.refreshPayoutStatus)(record.id);
                const payment = await (0, milestone_1.getPaymentRecord)(record.id);
                const milestone = payment.milestones[payment.milestones.length - 1];
                if (milestone)
                    db().prepare("INSERT INTO payouts(case_id,paypal_batch_id,status,payload,created_at) VALUES(?,?,?,?,?)").run(record.id, milestone.payoutBatchId ?? null, milestone.payoutStatus ?? "unknown", JSON.stringify(milestone), (0, database_1.now)());
                res.json({ status: result });
                return;
            }
            if (action === "review") {
                if (record.ownerId !== req.user.id) {
                    res.status(403).json({ error: "Only the client who owns this case can accept or decline it." });
                    return;
                }
                const decision = required(jsonBody(req), "decision");
                if (decision !== "release" && decision !== "reject")
                    throw new Error("Invalid review decision.");
                const result = await (0, review_handoff_1.resolveReviewHandoff)(record.id, decision, req.user.name, userById(record.workerId)?.paypalEmail);
                db().prepare("INSERT INTO reviews(case_id,reviewer_id,status,decision,payload,created_at) VALUES(?,?,?,?,?,?)").run(record.id, req.user.id, "resolved", decision, JSON.stringify(result), (0, database_1.now)());
                res.json(result);
                return;
            }
            throw new Error("Unknown action.");
        }
        catch (error) {
            next(error);
        }
    });
    app.use(express_1.default.static(node_path_1.default.resolve(__dirname, "..", "public")));
    app.use((error, _req, res, _next) => { const message = error instanceof Error ? error.message : "Request failed."; res.status(message === "Case not found." ? 404 : 400).json({ error: message }); });
    return app;
}
