import fs from "node:fs/promises";
import { readReview, resolveReviewHandoff, reviewMarkdownPath, timeRemaining } from "../src/review-handoff";
const caseIndex = process.argv.indexOf("--case");
const decisionIndex = process.argv.indexOf("--decision");
const caseId = caseIndex >= 0 ? process.argv[caseIndex + 1] : undefined;
const decision = decisionIndex >= 0 ? process.argv[decisionIndex + 1] as "release" | "reject" : undefined;
if (!caseId) throw new Error("Usage: npm run review -- --case <id> --decision release|reject");
async function main(): Promise<void> {
  const review = await readReview(caseId);
  console.log(await fs.readFile(reviewMarkdownPath(caseId), "utf8"));
  const remaining = timeRemaining(review.expirationTime);
  console.log(`Time remaining: ${remaining.text}`);
  if (remaining.warning) console.log("Warning: less than 24 hours remain before authorization expiry.");
  if (!decision || !["release", "reject"].includes(decision)) {
    console.log("Usage: npm run review -- --case <id> --decision release|reject");
    return;
  }
  const resolved = await resolveReviewHandoff(caseId, decision);
  console.log(`Review ${decision} completed for ${caseId}. Status: ${resolved.status}.`);
}
main()
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
