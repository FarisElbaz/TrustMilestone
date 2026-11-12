// Isolation achieved: temporary directory, restricted environment, timeout, and Docker --network none when Docker is available.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outputRoot } from "./paths";

const execFileAsync = promisify(execFile);
export interface TestResult { name: string; status: "passed" | "failed" | "unknown"; failureMessage?: string; requirementId?: string; }

function requirementFor(name: string, tests: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:test|it)\\s*\\(\\s*["'\`]` + escaped + `["'\`]`, "i");
  const match = pattern.exec(tests);
  const snippet = match ? tests.slice(match.index, match.index + 1000) : (tests.indexOf(name) >= 0 ? tests.slice(tests.indexOf(name), tests.indexOf(name) + 1000) : tests);
  return snippet.match(/\/\/\s*(REQ-\d+)/i)?.[1]?.toUpperCase();
}

function parseReport(output: string): { testResults?: { assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[] }[] } {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("Jest returned no JSON report");
  for (let end = start + 1; end <= output.length; end++) {
    if (output[end - 1] !== "}") continue;
    try {
      return JSON.parse(output.slice(start, end)) as ReturnType<typeof parseReport>;
    } catch { /* continue until the complete JSON object is found */ }
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
async function resolveConfigSourceDir(caseId: string): Promise<string | undefined> {
  // 1. Check out/<caseId>/ for a package.json placed there already
  const outCaseDir = path.resolve(outputRoot(), caseId);
  try {
    await fs.access(path.join(outCaseDir, "package.json"));
    return outCaseDir;
  } catch { /* not there */ }

  // 2. Read case-record.json to find templateId
  let templateId: string | undefined;
  try {
    const record = JSON.parse(await fs.readFile(path.join(outCaseDir, "case-record.json"), "utf8")) as { templateId?: string };
    templateId = record.templateId;
  } catch { /* no case-record */ }

  if (templateId) {
    const refDir = path.resolve("testset", "cases", templateId, "reference");
    try {
      await fs.access(path.join(refDir, "package.json"));
      return refDir;
    } catch { /* not there */ }
  }

  // 3. Try testset/cases/<caseId>/reference/ (the case is itself a testset entry)
  const testsetRefDir = path.resolve("testset", "cases", caseId, "reference");
  try {
    await fs.access(path.join(testsetRefDir, "package.json"));
    return testsetRefDir;
  } catch { /* not there */ }

  return undefined;
}

export async function runTests(submissionDir: string, testDir: string): Promise<TestResult[]> {
  // Derive the caseId from the testDir path so we can locate config files.
  // testDir is either out/<caseId>/tests or testset/cases/<caseId>/reference/tests
  const caseId = (() => {
    const parts = testDir.replace(/\\/g, "/").split("/");
    // Walk back past "tests" (and "reference" if present) to find the caseId.
    // testDir may be:
    //   out/<caseId>/tests                            → parts[idx-1] = caseId ✓
    //   testset/cases/<caseId>/reference/tests        → parts[idx-1] = "reference", parts[idx-2] = caseId
    const testsIdx = parts.lastIndexOf("tests");
    if (testsIdx <= 0) return "";
    const preceding = parts[testsIdx - 1];
    if (preceding === "reference" && testsIdx >= 2) return parts[testsIdx - 2];
    return preceding;
  })();

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-verifier-"));
  try {
    await fs.cp(submissionDir, temp, { recursive: true });
    // If the submission is wrapped in a top-level directory (e.g. V1_correct/src, zip root), hoist files
    const tempEntries = await fs.readdir(temp);
    const hasRootCode = tempEntries.includes("src") || tempEntries.includes("package.json") || tempEntries.includes("app.ts");
    if (!hasRootCode) {
      for (const entry of tempEntries) {
        if (entry === "tests") continue;
        const subPath = path.join(temp, entry);
        try {
          const stat = await fs.stat(subPath);
          if (stat.isDirectory()) {
            const subEntries = await fs.readdir(subPath);
            if (subEntries.includes("src") || subEntries.includes("app.ts") || subEntries.includes("package.json")) {
              await fs.cp(subPath, temp, { recursive: true });
              break;
            }
          }
        } catch {}
      }
    }
    await fs.cp(testDir, path.join(temp, "tests"), { recursive: true });

    // --- Copy config files into the temp sandbox ---
    const configSrcDir = await resolveConfigSourceDir(caseId);
    if (!configSrcDir) {
      throw new Error(
        `No package.json found for case "${caseId}". ` +
        `Looked in: out/${caseId}/, testset/cases/<templateId>/reference/, testset/cases/${caseId}/reference/. ` +
        `Cannot run npm test without a package.json.`
      );
    }
    // Verify package.json is actually present (resolveConfigSourceDir already checked, but be explicit)
    try {
      await fs.access(path.join(configSrcDir, "package.json"));
    } catch {
      throw new Error(`package.json not found in resolved config source directory "${configSrcDir}". Cannot run npm test.`);
    }
    for (const file of CONFIG_FILES) {
      try {
        await fs.copyFile(path.join(configSrcDir, file), path.join(temp, file));
      } catch { /* file doesn't exist in this template — skip */ }
    }

    const env = { PATH: process.env.PATH ?? "", NODE_ENV: "test" };
    const docker = await execFileAsync("docker", ["--version"]).then(() => true).catch(() => false);
    const npmCli = path.resolve(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    const command = docker ? "docker" : process.execPath;
    const args = docker
      ? ["run", "--rm", "--network", "none", "--read-only", "-v", `${temp}:/workspace`, "-w", "/workspace", "node:20", "sh", "-c", "npm install --ignore-scripts && npm test -- --json"]
      : [npmCli, "install", "--ignore-scripts"];
    if (!docker) await execFileAsync(command, args, { cwd: temp, env, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const testArgs = docker ? [] : [npmCli, "test", "--", "--json"];
    const result = await execFileAsync(command, testArgs, { cwd: temp, env, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const report = parseReport(result.stdout);
    const testFiles = await fs.readdir(path.join(temp, "tests"));
    const source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => fs.readFile(path.join(temp, "tests", f), "utf8")))).join("\n");
    return (report.testResults ?? []).flatMap((file) => (file.assertionResults ?? []).map((test) => ({
      name: test.fullName,
      status: test.status === "passed" ? "passed" : "failed",
      failureMessage: test.failureMessages?.join("\n"),
      requirementId: requirementFor(test.fullName, source)
    })));
  } catch (error) {
    if (error && typeof error === "object" && "stdout" in error) {
      try {
        const report = parseReport(String((error as { stdout?: unknown }).stdout ?? ""));
        let source = "";
        try {
          const testFiles = await fs.readdir(path.join(temp, "tests"));
          source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => fs.readFile(path.join(temp, "tests", f), "utf8")))).join("\n");
        } catch {
          try {
            const testFiles = await fs.readdir(testDir);
            source = (await Promise.all(testFiles.filter((f) => /\.(ts|js)$/.test(f)).map((f) => fs.readFile(path.join(testDir, f), "utf8")))).join("\n");
          } catch {}
        }
        return report.testResults?.flatMap((f) => f.assertionResults ?? []).map((t) => ({
          name: t.fullName,
          status: t.status === "passed" ? "passed" : "failed",
          failureMessage: t.failureMessages?.join("\n"),
          requirementId: requirementFor(t.fullName, source)
        })) ?? [];
      } catch { /* report unavailable; surface the process failure below */ }
    }
    throw new Error(`Sandbox tests failed to run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
