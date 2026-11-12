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
const paths_1 = require("./paths");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
function requirementFor(name, tests) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?:test|it)\\s*\\(\\s*["'\`]` + escaped + `["'\`]`, "i");
    const match = pattern.exec(tests);
    const snippet = match ? tests.slice(match.index, match.index + 1000) : (tests.indexOf(name) >= 0 ? tests.slice(tests.indexOf(name), tests.indexOf(name) + 1000) : tests);
    return snippet.match(/\/\/\s*(REQ-\d+)/i)?.[1]?.toUpperCase();
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
/** Config files that must accompany tests so "npm test" works. */
const CONFIG_FILES = ["package.json", "tsconfig.json", "jest.config.js", "jest.config.ts", "jest.config.cjs", "jest.config.mjs"];
/**
 * Resolve the config-file source directory for a given case.
 *
 * Priority:
 *  1. out/<caseId>/ (overrides placed there by the app when creating a template case)
 *  2. testset/cases/<templateId>/reference/   (the template's reference implementation)
 *  3. testset/cases/<caseId>/reference/        (the case IS itself a testset template)
 *
 * Returns the directory path, or undefined if none can be found.
 */
async function resolveConfigSourceDir(caseId) {
    // 1. Check out/<caseId>/ for a package.json placed there already
    const outCaseDir = node_path_1.default.resolve((0, paths_1.outputRoot)(), caseId);
    try {
        await promises_1.default.access(node_path_1.default.join(outCaseDir, "package.json"));
        return outCaseDir;
    }
    catch { /* not there */ }
    // 2. Read case-record.json to find templateId
    let templateId;
    try {
        const record = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(outCaseDir, "case-record.json"), "utf8"));
        templateId = record.templateId;
    }
    catch { /* no case-record */ }
    if (templateId) {
        const refDir = node_path_1.default.resolve("testset", "cases", templateId, "reference");
        try {
            await promises_1.default.access(node_path_1.default.join(refDir, "package.json"));
            return refDir;
        }
        catch { /* not there */ }
    }
    // 3. Try testset/cases/<caseId>/reference/ (the case is itself a testset entry)
    const testsetRefDir = node_path_1.default.resolve("testset", "cases", caseId, "reference");
    try {
        await promises_1.default.access(node_path_1.default.join(testsetRefDir, "package.json"));
        return testsetRefDir;
    }
    catch { /* not there */ }
    return undefined;
}
async function runTests(submissionDir, testDir) {
    // Derive the caseId from the testDir path so we can locate config files.
    // testDir is either out/<caseId>/tests or testset/cases/<caseId>/reference/tests
    const caseId = (() => {
        const parts = testDir.replace(/\\/g, "/").split("/");
        // Walk back past "tests" (and "reference" if present) to find the caseId.
        // testDir may be:
        //   out/<caseId>/tests                            → parts[idx-1] = caseId ✓
        //   testset/cases/<caseId>/reference/tests        → parts[idx-1] = "reference", parts[idx-2] = caseId
        const testsIdx = parts.lastIndexOf("tests");
        if (testsIdx <= 0)
            return "";
        const preceding = parts[testsIdx - 1];
        if (preceding === "reference" && testsIdx >= 2)
            return parts[testsIdx - 2];
        return preceding;
    })();
    const temp = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "delivery-verifier-"));
    try {
        await promises_1.default.cp(submissionDir, temp, { recursive: true });
        // If the submission is wrapped in a top-level directory (e.g. V1_correct/src, zip root), hoist files
        const tempEntries = await promises_1.default.readdir(temp);
        const hasRootCode = tempEntries.includes("src") || tempEntries.includes("package.json") || tempEntries.includes("app.ts");
        if (!hasRootCode) {
            for (const entry of tempEntries) {
                if (entry === "tests")
                    continue;
                const subPath = node_path_1.default.join(temp, entry);
                try {
                    const stat = await promises_1.default.stat(subPath);
                    if (stat.isDirectory()) {
                        const subEntries = await promises_1.default.readdir(subPath);
                        if (subEntries.includes("src") || subEntries.includes("app.ts") || subEntries.includes("package.json")) {
                            await promises_1.default.cp(subPath, temp, { recursive: true });
                            break;
                        }
                    }
                }
                catch { }
            }
        }
        await promises_1.default.cp(testDir, node_path_1.default.join(temp, "tests"), { recursive: true });
        // --- Copy config files into the temp sandbox ---
        const configSrcDir = await resolveConfigSourceDir(caseId);
        if (!configSrcDir) {
            throw new Error(`No package.json found for case "${caseId}". ` +
                `Looked in: out/${caseId}/, testset/cases/<templateId>/reference/, testset/cases/${caseId}/reference/. ` +
                `Cannot run npm test without a package.json.`);
        }
        // Verify package.json is actually present (resolveConfigSourceDir already checked, but be explicit)
        try {
            await promises_1.default.access(node_path_1.default.join(configSrcDir, "package.json"));
        }
        catch {
            throw new Error(`package.json not found in resolved config source directory "${configSrcDir}". Cannot run npm test.`);
        }
        for (const file of CONFIG_FILES) {
            try {
                await promises_1.default.copyFile(node_path_1.default.join(configSrcDir, file), node_path_1.default.join(temp, file));
            }
            catch { /* file doesn't exist in this template — skip */ }
        }
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
                let source = "";
                try {
                    const testFiles = await promises_1.default.readdir(node_path_1.default.join(temp, "tests"));
                    source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => promises_1.default.readFile(node_path_1.default.join(temp, "tests", f), "utf8")))).join("\n");
                }
                catch {
                    try {
                        const testFiles = await promises_1.default.readdir(testDir);
                        source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => promises_1.default.readFile(node_path_1.default.join(testDir, f), "utf8")))).join("\n");
                    }
                    catch { }
                }
                return report.testResults?.flatMap((f) => f.assertionResults ?? []).map((t) => ({
                    name: t.fullName,
                    status: t.status === "passed" ? "passed" : "failed",
                    failureMessage: t.failureMessages?.join("\n"),
                    requirementId: requirementFor(t.fullName, source)
                })) ?? [];
            }
            catch { /* report unavailable; surface the process failure below */ }
        }
        throw new Error(`Sandbox tests failed to run: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        await promises_1.default.rm(temp, { recursive: true, force: true });
    }
}
