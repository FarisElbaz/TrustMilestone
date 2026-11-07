"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUiServer = createUiServer;
exports.startUiServer = startUiServer;
const node_http_1 = __importDefault(require("node:http"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const busboy_1 = __importDefault(require("busboy"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const criteria_approval_1 = require("./criteria-approval");
const milestone_1 = require("./milestone");
const review_handoff_1 = require("./review-handoff");
const verify_1 = require("./verify");
const port = Number(process.env.UI_PORT ?? 3000);
const host = "127.0.0.1";
const publicDirectory = node_path_1.default.resolve(__dirname, "..", "public");
const maxUploadBytes = 50 * 1024 * 1024;
const idPattern = /^[A-Za-z0-9._-]+$/;
const caseRoot = (caseId) => node_path_1.default.resolve("out", caseId);
const caseFile = (caseId, name) => node_path_1.default.join(caseRoot(caseId), name);
function assertSandboxConfiguration() {
    if (process.env.PAYPAL_ENV !== "sandbox")
        throw new Error('UI requires PAYPAL_ENV to be exactly "sandbox".');
}
function assertCaseId(caseId) {
    if (!idPattern.test(caseId))
        throw new Error("Case ID may contain only letters, numbers, dots, underscores, and hyphens.");
}
function json(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}
async function readJson(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Request body must be a JSON object.");
    return parsed;
}
function requiredString(body, field) {
    const value = body[field];
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${field} is required.`);
    return value.trim();
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
async function listCaseIds() {
    const ids = new Set();
    for (const root of [node_path_1.default.resolve("testset", "cases"), node_path_1.default.resolve("out")]) {
        try {
            for (const entry of await promises_1.default.readdir(root, { withFileTypes: true }))
                if (entry.isDirectory() && idPattern.test(entry.name))
                    ids.add(entry.name);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    return [...ids].sort();
}
async function caseSummary(caseId) {
    const criteria = await readOptionalJson(caseFile(caseId, "criteria.json"));
    const payment = await readOptionalJson(caseFile(caseId, "paypal.json"));
    const result = await readOptionalJson(caseFile(caseId, "result.json"));
    const review = await readOptionalJson(caseFile(caseId, "review.json"));
    let submission = false;
    try {
        submission = (await promises_1.default.readdir(caseFile(caseId, "submission"))).length > 0;
    }
    catch { /* absent submission */ }
    let stage = "brief added";
    if (criteria?.status === "proposed")
        stage = "criteria proposed";
    if (criteria?.status === "approved")
        stage = "criteria approved";
    if (payment?.orderId && !payment.authorizationId)
        stage = "awaiting buyer approval";
    if (payment?.authorizationId)
        stage = "authorized";
    if (submission)
        stage = "submitted";
    if (result?.decision === "release")
        stage = "released";
    if (result?.decision === "reject")
        stage = "rejected";
    if (result?.decision === "escalate")
        stage = review?.status === "pending" ? "in review" : "needs review";
    if (payment?.milestones && Array.isArray(payment.milestones) && payment.milestones.length > 0)
        stage = "released";
    return { caseId, stage, criteria, payment, result, review, submission };
}
async function caseDetail(caseId) {
    assertCaseId(caseId);
    const summary = await caseSummary(caseId);
    const review = summary.review;
    const events = [];
    const files = ["criteria.json", "paypal.json", "result.json", "review.json"];
    for (const filename of files) {
        const data = await readOptionalJson(caseFile(caseId, filename));
        if (!data)
            continue;
        const timestamp = String(data.approvedAt ?? data.createdAt ?? data.timestamp ?? data.escalatedAt ?? new Date(0).toISOString());
        events.push({ timestamp, event: filename.replace(".json", ""), status: typeof data.status === "string" ? data.status : typeof data.decision === "string" ? data.decision : undefined });
    }
    events.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    if (review) {
        try {
            summary.review.markdown = await promises_1.default.readFile((0, review_handoff_1.reviewMarkdownPath)(caseId), "utf8");
            summary.review.remaining = (0, review_handoff_1.timeRemaining)(String(review.expirationTime ?? ""));
        }
        catch { /* review JSON remains available when markdown is absent */ }
    }
    return { ...summary, events, buyerEmail: process.env.PAYPAL_BUYER_EMAIL ?? "not configured" };
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
async function parseUpload(request, caseId) {
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (contentLength > maxUploadBytes)
        throw new Error("Upload exceeds the 50 MB limit.");
    const root = caseFile(caseId, "submission");
    const temporary = `${root}.uploading`;
    await promises_1.default.rm(temporary, { recursive: true, force: true });
    await promises_1.default.mkdir(temporary, { recursive: true });
    const files = [];
    let total = 0;
    await new Promise((resolve, reject) => {
        const parser = (0, busboy_1.default)({ headers: request.headers, preservePath: true, limits: { fileSize: maxUploadBytes, files: 100 } });
        parser.on("file", (_field, stream, info) => {
            const chunks = [];
            stream.on("data", (chunk) => {
                total += chunk.length;
                if (total > maxUploadBytes)
                    stream.destroy(new Error("Upload exceeds the 50 MB limit."));
                else
                    chunks.push(chunk);
            });
            stream.on("limit", () => reject(new Error("Upload exceeds the 50 MB limit.")));
            stream.on("error", reject);
            stream.on("end", () => files.push({ filename: info.filename || "upload.bin", data: Buffer.concat(chunks) }));
        });
        parser.on("error", reject);
        parser.on("finish", resolve);
        request.pipe(parser);
    });
    const names = [];
    try {
        for (const file of files) {
            if (file.filename.toLowerCase().endsWith(".zip")) {
                const zip = new adm_zip_1.default(file.data);
                for (const entry of zip.getEntries()) {
                    if (entry.isDirectory)
                        continue;
                    const target = safeUploadPath(temporary, entry.entryName);
                    const data = entry.getData();
                    total += data.length;
                    if (total > maxUploadBytes)
                        throw new Error("Extracted upload exceeds the 50 MB limit.");
                    await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
                    await promises_1.default.writeFile(target, data);
                    names.push(node_path_1.default.relative(temporary, target));
                }
            }
            else {
                const target = safeUploadPath(temporary, file.filename);
                await promises_1.default.mkdir(node_path_1.default.dirname(target), { recursive: true });
                await promises_1.default.writeFile(target, file.data);
                names.push(node_path_1.default.relative(temporary, target));
            }
        }
        await promises_1.default.rm(root, { recursive: true, force: true });
        await promises_1.default.rename(temporary, root);
        return names.sort();
    }
    catch (error) {
        await promises_1.default.rm(temporary, { recursive: true, force: true });
        throw error;
    }
}
async function api(request, response, pathname) {
    if (pathname === "/api/cases" && request.method === "GET") {
        json(response, 200, await Promise.all((await listCaseIds()).map(caseSummary)));
        return;
    }
    const match = pathname.match(/^\/api\/cases\/([^/]+)(?:\/(.*))?$/);
    if (!match) {
        json(response, 404, { error: "Not found." });
        return;
    }
    const caseId = decodeURIComponent(match[1]);
    assertCaseId(caseId);
    const action = match[2] ?? "";
    if (request.method === "GET" && !action) {
        json(response, 200, await caseDetail(caseId));
        return;
    }
    if (request.method === "POST" && action === "create") {
        const body = await readJson(request);
        const brief = requiredString(body, "brief");
        const stack = requiredString(body, "stack");
        if (await promises_1.default.stat(caseRoot(caseId)).then(() => true).catch(() => false) || (await listCaseIds()).includes(caseId))
            throw new Error(`Case ${caseId} already exists.`);
        await promises_1.default.mkdir(caseRoot(caseId), { recursive: true });
        await promises_1.default.writeFile(caseFile(caseId, "brief.md"), brief);
        await promises_1.default.writeFile(caseFile(caseId, "manifest.json"), JSON.stringify({ stack }, null, 2));
        json(response, 201, await caseDetail(caseId));
        return;
    }
    if (request.method === "POST" && (action === "criteria" || action === "revise")) {
        const body = action === "revise" ? await readJson(request) : {};
        const brief = await promises_1.default.readFile(caseFile(caseId, "brief.md"), "utf8");
        const stackData = await readJsonFile(caseFile(caseId, "manifest.json"));
        const criteria = await (0, criteria_approval_1.proposeCriteria)(caseId, `${brief}${body.note ? `\n\nClient revision note:\n${String(body.note)}` : ""}`, String(stackData.stack ?? "Node 20"));
        json(response, 200, criteria);
        return;
    }
    if (request.method === "POST" && (action === "criteria/approve" || action === "approve")) {
        json(response, 200, await (0, criteria_approval_1.approveStoredCriteria)(caseId));
        return;
    }
    if (request.method === "POST" && action === "fund") {
        const criteria = await (0, criteria_approval_1.readStoredCriteria)(caseId);
        if (criteria.status !== "approved")
            throw new Error("Approve criteria before creating a buyer order.");
        const body = await readJson(request);
        json(response, 200, await (0, milestone_1.fundCase)(caseId, requiredString(body, "amount"), requiredString(body, "currency")));
        return;
    }
    if (request.method === "POST" && action === "status") {
        json(response, 200, await (0, milestone_1.paymentStatus)(caseId));
        return;
    }
    if (request.method === "POST" && action === "upload") {
        json(response, 200, { files: await parseUpload(request, caseId) });
        return;
    }
    if (request.method === "POST" && action === "verify") {
        const criteria = await (0, criteria_approval_1.readStoredCriteria)(caseId);
        if (criteria.status !== "approved")
            throw new Error("Approve criteria before running verification.");
        const payment = await (0, milestone_1.getPaymentRecord)(caseId);
        if (!payment.authorizationId)
            throw new Error("Authorize the PayPal order before running verification.");
        const submission = caseFile(caseId, "submission");
        await promises_1.default.access(submission);
        const caseDir = await promises_1.default.stat(node_path_1.default.resolve("testset", "cases", caseId)).then(() => node_path_1.default.resolve("testset", "cases", caseId)).catch(() => caseRoot(caseId));
        json(response, 200, await (0, verify_1.verify)(caseDir, submission));
        return;
    }
    if (request.method === "GET" && action === "review") {
        const review = await (0, review_handoff_1.readReview)(caseId);
        json(response, 200, { ...review, markdown: await promises_1.default.readFile((0, review_handoff_1.reviewMarkdownPath)(caseId), "utf8"), remaining: (0, review_handoff_1.timeRemaining)(review.expirationTime) });
        return;
    }
    if (request.method === "POST" && action === "review") {
        const body = await readJson(request);
        const decision = requiredString(body, "decision");
        if (decision !== "release" && decision !== "reject")
            throw new Error("decision must be release or reject.");
        json(response, 200, await (0, review_handoff_1.resolveReviewHandoff)(caseId, decision));
        return;
    }
    if (request.method === "POST" && action === "payout/refresh") {
        json(response, 200, await (0, milestone_1.refreshPayoutStatus)(caseId));
        return;
    }
    json(response, 405, { error: "Method not allowed." });
}
async function readJsonFile(filename) {
    return JSON.parse(await promises_1.default.readFile(filename, "utf8"));
}
async function staticFile(response, pathname) {
    const filename = node_path_1.default.resolve(publicDirectory, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!filename.startsWith(`${publicDirectory}${node_path_1.default.sep}`)) {
        json(response, 403, { error: "Forbidden." });
        return;
    }
    try {
        const content = await promises_1.default.readFile(filename);
        const type = filename.endsWith(".css") ? "text/css" : filename.endsWith(".js") ? "text/javascript" : "text/html";
        response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        response.end(content);
    }
    catch {
        json(response, 404, { error: "Not found." });
    }
}
function createUiServer(options = {}) {
    if (options.listen !== false)
        assertSandboxConfiguration();
    return node_http_1.default.createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://${host}`);
        Promise.resolve(url.pathname.startsWith("/api/") ? api(request, response, url.pathname) : staticFile(response, url.pathname))
            .catch((error) => json(response, 400, { error: error instanceof Error ? error.message : String(error) }));
    });
}
function startUiServer() {
    assertSandboxConfiguration();
    const server = createUiServer({ listen: false, port });
    server.listen(port, host, () => console.log(`Delivery verifier UI: http://${host}:${port}`));
    return server;
}
