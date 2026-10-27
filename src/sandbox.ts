// Isolation achieved: temporary directory, restricted environment, timeout, and Docker --network none when Docker is available.
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export interface TestResult { name: string; status: "passed" | "failed" | "unknown"; failureMessage?: string; requirementId?: string; }

function requirementFor(name: string, tests: string): string | undefined {
  const index = tests.indexOf(`test("${name}"`);
  const snippet = index >= 0 ? tests.slice(index, index + 1000) : tests;
  return snippet.match(/\/\/\s*(REQ-\d+)/)?.[1];
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

export async function runTests(submissionDir: string, testDir: string): Promise<TestResult[]> {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "delivery-verifier-"));
  try {
    await fs.cp(submissionDir, temp, { recursive: true });
    await fs.cp(testDir, path.join(temp, "tests"), { recursive: true });
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
        return report.testResults?.flatMap((f) => f.assertionResults ?? []).map((t) => ({ name: t.fullName, status: t.status === "passed" ? "passed" : "failed", failureMessage: t.failureMessages?.join("\n") })) ?? [];
      } catch { /* report unavailable; surface the process failure below */ }
    }
    throw new Error(`Sandbox tests failed to run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
