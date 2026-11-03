import { resolveReview } from "../src/milestone";
const caseIndex = process.argv.indexOf("--case");
const decisionIndex = process.argv.indexOf("--decision");
const caseId = process.argv[caseIndex + 1];
const decision = process.argv[decisionIndex + 1] as "release" | "reject";
if (!caseId || !["release", "reject"].includes(decision)) throw new Error("Usage: --case <id> --decision release|reject");
resolveReview(caseId, decision)
  .then(() => { console.log(`Review ${decision} completed for ${caseId}.`); })
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
