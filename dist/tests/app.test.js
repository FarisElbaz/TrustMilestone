"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("../src/app");
const database_1 = require("../src/database");
let base;
let server;
let tempDir;
let dbFile;
async function request(client, route, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("cookie", client.cookie);
    if (init.method && init.method !== "GET")
        headers.set("x-csrf-token", client.csrf);
    return fetch(`${base}${route}`, { ...init, headers });
}
async function newClient() {
    const response = await fetch(`${base}/health`);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    return { cookie, csrf: response.headers.get("x-csrf-token") ?? "" };
}
async function signup(role, email) {
    const client = await newClient();
    const response = await request(client, "/api/auth/signup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name: role, password: "correct horse battery", paypalEmail: `${role}@sandbox.test`, role })
    });
    expect(response.status).toBe(201);
    return client;
}
async function login(email) {
    const client = await newClient();
    const response = await request(client, "/api/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "correct horse battery" })
    });
    expect(response.status).toBe(200);
    return client;
}
beforeAll(async () => {
    (0, database_1.closeDatabase)();
    tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "app-test-"));
    dbFile = node_path_1.default.join(tempDir, "delivery-verifier.sqlite");
    process.env.DATABASE_PATH = dbFile;
    process.env.OUTPUT_ROOT = node_path_1.default.join(tempDir, "out");
    process.env.SUBMISSIONS_PATH = node_path_1.default.join(tempDir, "submissions");
    process.env.PAYMENT_MODE = "mock";
    server = (0, app_1.createApp)().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Server did not bind.");
    base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    (0, database_1.closeDatabase)();
    await promises_1.default.rm(tempDir, { recursive: true, force: true });
});
test("signs up, logs in, and rejects a wrong password", async () => {
    const client = await signup("client", "auth-client@example.test");
    const response = await request(client, "/api/auth/logout", { method: "POST" });
    expect(response.status).toBe(204);
    const login = await newClient();
    const wrong = await request(login, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "auth-client@example.test", password: "wrong password" }) });
    expect(wrong.status).toBe(401);
});
test("rate limits repeated login attempts", async () => {
    const client = await newClient();
    let last = 0;
    for (let index = 0; index < 11; index++) {
        last = (await request(client, "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "none@example.test", password: "wrong password" }) })).status;
    }
    expect(last).toBe(429);
});
test("blocks a worker from another worker's case", async () => {
    const client = await signup("client", "owner@example.test");
    const worker = await signup("worker", "assigned@example.test");
    const otherWorker = await signup("worker", "other@example.test");
    const created = await request(client, "/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "owned-case", brief: "brief", stack: "Node 20", workerEmail: "assigned@example.test", templateId: "c01" }) });
    expect(created.status).toBe(201);
    const blocked = await request(otherWorker, "/api/cases/owned-case");
    expect(blocked.status).toBe(404);
    expect((await request(worker, "/api/cases/owned-case")).status).toBe(200);
});
test("only the owning client can accept or decline an escalated case", async () => {
    const worker = await login("assigned@example.test");
    const blocked = await request(worker, "/api/cases/owned-case/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "release" }) });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: "Only the client who owns this case can accept or decline it." });
    const client = await login("owner@example.test");
    const allowed = await request(client, "/api/cases/owned-case/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "release" }) });
    expect(allowed.status).not.toBe(403);
});
test("refuses a case ID that is taken or has leftover files from an earlier case", async () => {
    const client = await login("owner@example.test");
    const create = (id) => request(client, "/api/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, brief: "brief", stack: "Node 20", workerEmail: "assigned@example.test", templateId: "c01" }) });
    const taken = await create("owned-case");
    expect(taken.status).toBe(400);
    expect(await taken.json()).toMatchObject({ error: 'Case ID "owned-case" is already taken. Choose a different ID.' });
    const leftover = node_path_1.default.join(process.env.OUTPUT_ROOT, "leftover-case");
    await promises_1.default.mkdir(leftover, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(leftover, "criteria.json"), JSON.stringify({ caseId: "leftover-case", status: "approved", criteria: [] }));
    const reused = await create("leftover-case");
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: 'Case ID "leftover-case" was used before and still has saved files. Choose a different ID.' });
    expect(JSON.parse(await promises_1.default.readFile(node_path_1.default.join(leftover, "criteria.json"), "utf8")).status).toBe("approved");
});
test("reviewer role is no longer accepted at signup", async () => {
    const response = await request(await newClient(), "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "R", email: "reviewer@example.test", password: "correct horse battery", paypalEmail: "r@sandbox.test", role: "reviewer" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid password or role." });
});
test("rejects state changes without CSRF", async () => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "none@example.test", password: "wrong password" }) });
    expect(response.status).toBe(403);
});
test("rejects upload path traversal", async () => {
    const worker = await login("assigned@example.test");
    const raw = "--boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"../escape.txt\"\r\nContent-Type: text/plain\r\n\r\nnope\r\n--boundary--\r\n";
    const response = await request(worker, "/api/cases/owned-case/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=boundary" }, body: raw });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Upload contains a path traversal." });
});
test("uploads submission for an existing case and creates final folder with files", async () => {
    const worker = await login("assigned@example.test");
    const raw = "--boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"test-submission.txt\"\r\nContent-Type: text/plain\r\n\r\nvalid submission content\r\n--boundary--\r\n";
    const response = await request(worker, "/api/cases/owned-case/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=boundary" }, body: raw });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.files).toContain("test-submission.txt");
    const finalFilePath = node_path_1.default.join(process.env.SUBMISSIONS_PATH ?? node_path_1.default.resolve("data", "submissions"), "owned-case", "test-submission.txt");
    const content = await promises_1.default.readFile(finalFilePath, "utf8");
    expect(content).toBe("valid submission content");
});
