import fs from "node:fs/promises";
import path from "node:path";
import type { Decision } from "./route";

export interface Milestone {
  releaseMilestone(caseId: string, decision: Decision): Promise<void>;
  holdMilestone(caseId: string, decision: Decision): Promise<void>;
}

async function write(caseId: string, action: string, decision: Decision): Promise<void> {
  await fs.mkdir(path.resolve("out"), { recursive: true });
  await fs.appendFile(path.resolve("out/milestones.log"), `${new Date().toISOString()} ${action} ${caseId} ${decision.decision}\n`);
}

export const milestone: Milestone = {
  async releaseMilestone(caseId, decision) {
    // TODO: integrate the sandbox milestone service here.
    await write(caseId, "release", decision);
  },
  async holdMilestone(caseId, decision) {
    await write(caseId, "hold", decision);
  }
};

export const releaseMilestone = milestone.releaseMilestone;
export const holdMilestone = milestone.holdMilestone;
