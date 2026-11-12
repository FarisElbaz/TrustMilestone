"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_http_1 = __importDefault(require("node:http"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("./milestone");
const config_1 = require("./paypal/config");
const port = Number(process.env.PORT ?? 3000);
const publicDirectory = node_path_1.default.resolve(process.env.WEB_PUBLIC_DIR ?? "public");
const caseIdPattern = /^[A-Za-z0-9._-]+$/;
function jsonResponse(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function requestBody(request) {
    const chunks = [];
    for await (const chunk of request)
        chunks.push(Buffer.from(chunk));
    if (!chunks.length)
        return {};
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("Request body must be a JSON object.");
    return body;
}
function requiredString(body, field) {
    const value = body[field];
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${field} is required.`);
    return value.trim();
}
function caseIdFromPath(pathname) {
    const caseId = decodeURIComponent(pathname.slice("/api/cases/".length).split("/")[0]);
    if (!caseIdPattern.test(caseId))
        throw new Error("caseId may contain only letters, numbers, dots, underscores, and hyphens.");
    return caseId;
}
async function api(request, response, pathname) {
    if (pathname === "/api/config" && request.method === "GET") {
        const sandboxReady = process.env.PAYMENT_MODE === "sandbox" && process.env.PAYPAL_ENV === "sandbox";
        jsonResponse(response, 200, {
            paymentMode: process.env.PAYMENT_MODE ?? "mock",
            paypalEnvironment: process.env.PAYPAL_ENV ?? "unset",
            sandboxReady,
            configuredAccounts: Boolean(process.env.PAYPAL_BUYER_EMAIL && process.env.PAYPAL_CONTRACTOR_EMAIL)
        });
        return;
    }
    if (!pathname.startsWith("/api/cases/")) {
        jsonResponse(response, 404, { error: "Not found." });
        return;
    }
    const caseId = caseIdFromPath(pathname);
    const action = pathname.slice(`/api/cases/${encodeURIComponent(caseId)}`.length);
    if (request.method === "POST" && action === "/fund") {
        const body = await requestBody(request);
        jsonResponse(response, 200, await (0, milestone_1.fundCase)(caseId, requiredString(body, "amount"), requiredString(body, "currency")));
        return;
    }
    if (request.method === "GET" && action === "") {
        jsonResponse(response, 200, await (0, milestone_1.getPaymentRecord)(caseId));
        return;
    }
    if (request.method !== "POST") {
        jsonResponse(response, 405, { error: "Method not allowed." });
        return;
    }
    const body = await requestBody(request);
    if (action === "/status") {
        jsonResponse(response, 200, await (0, milestone_1.paymentStatus)(caseId));
    }
    else if (action === "/release") {
        await (0, milestone_1.releaseMilestone)(caseId, requiredString(body, "amount"), typeof body.milestoneNumber === "number" ? body.milestoneNumber : 1);
        jsonResponse(response, 200, await (0, milestone_1.getPaymentRecord)(caseId));
    }
    else if (action === "/reject") {
        await (0, milestone_1.rejectMilestone)(caseId);
        jsonResponse(response, 200, await (0, milestone_1.getPaymentRecord)(caseId));
    }
    else if (action === "/hold") {
        await (0, milestone_1.holdMilestone)(caseId, requiredString(body, "deadline"));
        jsonResponse(response, 200, await (0, milestone_1.getPaymentRecord)(caseId));
    }
    else if (action === "/review") {
        const decision = body.decision;
        if (decision !== "release" && decision !== "reject")
            throw new Error("decision must be release or reject.");
        await (0, milestone_1.resolveReview)(caseId, decision);
        jsonResponse(response, 200, await (0, milestone_1.getPaymentRecord)(caseId));
    }
    else {
        jsonResponse(response, 404, { error: "Not found." });
    }
}
async function serveStatic(response, pathname) {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = node_path_1.default.resolve(publicDirectory, `.${requested}`);
    if (!filePath.startsWith(`${publicDirectory}${node_path_1.default.sep}`)) {
        jsonResponse(response, 403, { error: "Forbidden." });
        return;
    }
    try {
        const content = await promises_1.default.readFile(filePath);
        const contentType = filePath.endsWith(".css") ? "text/css" : filePath.endsWith(".js") ? "text/javascript" : "text/html";
        response.writeHead(200, { "Content-Type": `${contentType}; charset=utf-8` });
        response.end(content);
    }
    catch (error) {
        if (error.code === "ENOENT")
            jsonResponse(response, 404, { error: "Not found." });
        else
            throw error;
    }
}
const server = node_http_1.default.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    Promise.resolve()
        .then(() => url.pathname.startsWith("/api/") ? api(request, response, url.pathname) : serveStatic(response, url.pathname))
        .catch((error) => {
        const message = errorMessage(error);
        jsonResponse(response, message.includes("No PayPal record") ? 404 : 400, { error: message });
    });
});
server.listen(port, () => {
    try {
        if (process.env.PAYMENT_MODE === "sandbox") {
            // The form supplies amount and currency per case; validate the sandbox credentials here.
            (0, config_1.validatePaymentEnvironment)({ currency: process.env.PAYPAL_CURRENCY ?? "USD" });
        }
        console.log(`Milestone sandbox UI: http://localhost:${port}`);
    }
    catch (error) {
        console.error(`Invalid sandbox configuration: ${errorMessage(error)}`);
        process.exitCode = 1;
        server.close();
    }
});
