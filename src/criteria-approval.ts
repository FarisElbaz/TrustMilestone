import fs from "node:fs/promises";
import path from "node:path";
import { generateCriteria, type Criteria, type ModelCall } from "./criteria";
import { loadConfig } from "./config";
import { outputRoot } from "./paths";

export type CriteriaStatus = "proposed" | "approved" | "cancelled";
export interface StoredCriteria extends Criteria {
  caseId: string;
  status: CriteriaStatus;
  proposedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export const criteriaPath = (caseId: string): string => path.resolve(outputRoot(), caseId, "criteria.json");

async function writeCriteria(caseId: string, criteria: StoredCriteria): Promise<void> {
  await fs.mkdir(path.dirname(criteriaPath(caseId)), { recursive: true });
  await fs.writeFile(criteriaPath(caseId), JSON.stringify(criteria, null, 2));
}

export async function readStoredCriteria(caseId: string): Promise<StoredCriteria> {
  try {
    return JSON.parse(await fs.readFile(criteriaPath(caseId), "utf8")) as StoredCriteria;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No criteria file exists for case ${caseId}; run npm run criteria -- --case ${caseId}.`);
    }
    throw new Error(`Unable to read criteria for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function proposeCriteria(
  caseId: string,
  briefText: string,
  stack: string,
  modelCall?: ModelCall
): Promise<StoredCriteria> {
  const generated = await generateCriteria(briefText, stack, modelCall);
  const proposed: StoredCriteria = {
    caseId,
    ...generated,
    status: "proposed",
    proposedAt: new Date().toISOString()
  };
  await writeCriteria(caseId, proposed);
  return proposed;
}

export async function approveStoredCriteria(caseId: string, operatorName = process.env.OPERATOR_NAME ?? "unknown"): Promise<StoredCriteria> {
  const criteria = await readStoredCriteria(caseId);
  const approved: StoredCriteria = {
    ...criteria,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: operatorName
  };
  await writeCriteria(caseId, approved);
  return approved;
}

export async function invalidateCriteria(caseId: string): Promise<StoredCriteria> {
  const criteria = await readStoredCriteria(caseId);
  const invalidated: StoredCriteria = {
    ...criteria,
    status: "proposed",
    proposedAt: new Date().toISOString(),
    approvedAt: undefined,
    approvedBy: undefined
  };
  await writeCriteria(caseId, invalidated);
  return invalidated;
}

export function formatCriteria(criteria: Criteria): string {
  const lines = criteria.criteria.map((item) => `${item.id}: ${item.criterion} [${item.method}]`);
  if (criteria.open_questions.length) {
    lines.push("Open questions:");
    lines.push(...criteria.open_questions.map((item) => `- ${item.question}`));
  }
  return lines.join("\n");
}

export async function generateAndApproveCriteria(
  caseId: string,
  briefText: string,
  stack: string,
  prompt: (message: string) => Promise<string>,
  modelCall?: ModelCall
): Promise<StoredCriteria | undefined> {
  let current = await proposeCriteria(caseId, briefText, stack, modelCall);
  while (true) {
    console.log(formatCriteria(current));
    const decision = (await prompt('Type "approve", "revise", or "cancel": ')).trim().toLowerCase();
    if (decision === "approve") return approveStoredCriteria(caseId);
    if (decision === "cancel") {
      current.status = "cancelled";
      await writeCriteria(caseId, current);
      return undefined;
    }
    if (decision !== "revise") {
      console.log('Please type "approve", "revise", or "cancel".');
      continue;
    }
    const note = await prompt("Revision note: ");
    current = await proposeCriteria(caseId, `${briefText}\n\nClient revision note:\n${note}`, stack, modelCall);
  }
}

export function criteriaModelName(): string {
  return loadConfig().criteria_generator.model;
}
