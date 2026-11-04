import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { generateAndApproveCriteria } from "../src/criteria-approval";

const caseIndex = process.argv.indexOf("--case");
const caseId = caseIndex >= 0 ? process.argv[caseIndex + 1] : undefined;
if (!caseId) throw new Error("Usage: npm run criteria -- --case <case-id>");

async function main(): Promise<void> {
  const caseDir = path.resolve("testset", "cases", caseId);
  const brief = await fs.readFile(path.join(caseDir, "brief.md"), "utf8");
  const manifest = JSON.parse(await fs.readFile(path.join(caseDir, "manifest.json"), "utf8")) as { stack?: string };
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await generateAndApproveCriteria(caseId, brief, manifest.stack ?? "Node 20", (message) => readline.question(message));
    console.log(result ? `Criteria ${caseId} approved by ${result.approvedBy ?? "unknown"}.` : `Criteria ${caseId} cancelled.`);
  } finally {
    readline.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
