"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTests = runTests;
// Isolation achieved: temporary directory, restricted environment, timeout, and Docker --network none when Docker is available.
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function requirementFor(name, tests) {
    const index = tests.indexOf(`test("${name}"`);
    const snippet = index >= 0 ? tests.slice(index, index + 1000) : tests;
    return snippet.match(/\/\/\s*(REQ-\d+)/)?.[1];
}
function parseReport(output) {
    const start = output.indexOf("{");
    if (start < 0)
        throw new Error("Jest returned no JSON report");
    for (let end = start + 1; end <= output.length; end++) {
        if (output[end - 1] !== "}")
            continue;
        try {
            return JSON.parse(output.slice(start, end));
        }
        catch { /* continue until the complete JSON object is found */ }
    }
    throw new Error("Jest returned malformed JSON");
}
async function runTests(submissionDir, testDir) {
    const temp = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "delivery-verifier-"));
    try {
        await promises_1.default.cp(submissionDir, temp, { recursive: true });
        await promises_1.default.cp(testDir, node_path_1.default.join(temp, "tests"), { recursive: true });
        const env = { PATH: process.env.PATH ?? "", NODE_ENV: "test" };
        const docker = await execFileAsync("docker", ["--version"]).then(() => true).catch(() => false);
        const npmCli = node_path_1.default.resolve(node_path_1.default.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
        const command = docker ? "docker" : process.execPath;
        const args = docker
            ? ["run", "--rm", "--network", "none", "--read-only", "-v", `${temp}:/workspace`, "-w", "/workspace", "node:20", "sh", "-c", "npm install --ignore-scripts && npm test -- --json"]
            : [npmCli, "install", "--ignore-scripts"];
        if (!docker)
            await execFileAsync(command, args, { cwd: temp, env, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        const testArgs = docker ? [] : [npmCli, "test", "--", "--json"];
        const result = await execFileAsync(command, testArgs, { cwd: temp, env, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        const report = parseReport(result.stdout);
        const testFiles = await promises_1.default.readdir(node_path_1.default.join(temp, "tests"));
        const source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => promises_1.default.readFile(node_path_1.default.join(temp, "tests", f), "utf8")))).join("\n");
        return (report.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).map((test) => ({
            name: test.fullName,
            status: test.status === "passed" ? "passed" : "failed",
            failureMessage: test.failureMessages?.join("\n"),
            requirementId: requirementFor(test.fullName, source)
        })));
    }
    catch (error) {
        if (error && typeof error === "object" && "stdout" in error) {
            try {
                const report = parseReport(String(error.stdout ?? ""));
                return report.testResults?.flatMap((f) => f.assertionResults ?? []).map((t) => ({ name: t.fullName, status: t.status === "passed" ? "passed" : "failed", failureMessage: t.failureMessages?.join("\n") })) ?? [];
            }
            catch { /* report unavailable; surface the process failure below */ }
        }
        throw new Error(`Sandbox tests failed to run: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        await promises_1.default.rm(temp, { recursive: true, force: true });
    }
}
