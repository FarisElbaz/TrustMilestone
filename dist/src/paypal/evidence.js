"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEvidence = readEvidence;
exports.writeEvidence = writeEvidence;
exports.recordContractorBalances = recordContractorBalances;
exports.checkBusinessBalance = checkBusinessBalance;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const milestone_1 = require("../milestone");
const reporting_1 = require("./reporting");
const client_1 = require("./client");
const paths_1 = require("../paths");
const evidencePath = (caseId) => node_path_1.default.resolve((0, paths_1.outputRoot)(), caseId, "evidence.json");
async function readEvidence(caseId) {
    try {
        return JSON.parse(await promises_1.default.readFile(evidencePath(caseId), "utf8"));
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
        return { caseId, milestones: {}, updatedAt: new Date().toISOString() };
    }
}
async function writeEvidence(value) {
    await promises_1.default.mkdir(node_path_1.default.dirname(evidencePath(value.caseId)), { recursive: true });
    value.updatedAt = new Date().toISOString();
    await promises_1.default.writeFile(evidencePath(value.caseId), JSON.stringify(value, null, 2));
}
async function recordContractorBalances(caseId, milestoneNumber, before, after, record) {
    const beforeValue = Number(before);
    const afterValue = Number(after);
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue) || afterValue < beforeValue)
        throw new Error("Contractor after balance must be a number greater than or equal to the before balance.");
    const evidence = await readEvidence(caseId);
    const key = String(milestoneNumber);
    const item = evidence.milestones[key] ?? {};
    item.contractor = { before, after, enteredAt: new Date().toISOString() };
    item.checks = { ...(item.checks ?? {}), contractorBalance: afterValue - beforeValue >= Number(record.milestones.find((milestone) => milestone.number === milestoneNumber)?.amount ?? 0) };
    evidence.milestones[key] = item;
    const milestone = record.milestones.find((entry) => entry.number === milestoneNumber);
    if (milestone && item.checks.contractorBalance && item.checks.captureCompleted && item.checks.payoutSuccess && item.checks.businessBalance)
        milestone.status = "released";
    await (0, milestone_1.savePaymentRecord)(record);
    await writeEvidence(evidence);
    return evidence;
}
async function checkBusinessBalance(caseId, currency = "USD") {
    const caseFolder = node_path_1.default.resolve((0, paths_1.outputRoot)(), caseId);
    try {
        await promises_1.default.mkdir(caseFolder, { recursive: true });
    }
    catch {
        // ignore
    }
    try {
        const snapshot = await (0, reporting_1.getBalances)(currency);
        const evidence = await readEvidence(caseId);
        evidence.moneyChecks ??= {};
        evidence.moneyChecks.businessBalanceAfterRelease = {
            verified: true,
            httpStatus: 200,
            total: snapshot.total,
            currency: snapshot.currency,
            available: snapshot.available,
            capturedAt: snapshot.capturedAt
        };
        await writeEvidence(evidence);
        return { verified: true, total: snapshot.total, currency: snapshot.currency };
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            await promises_1.default.mkdir(caseFolder, { recursive: true });
            try {
                const snapshot = await (0, reporting_1.getBalances)(currency);
                const evidence = await readEvidence(caseId);
                evidence.moneyChecks ??= {};
                evidence.moneyChecks.businessBalanceAfterRelease = {
                    verified: true,
                    httpStatus: 200,
                    total: snapshot.total,
                    currency: snapshot.currency,
                    available: snapshot.available,
                    capturedAt: snapshot.capturedAt
                };
                await writeEvidence(evidence);
                return { verified: true, total: snapshot.total, currency: snapshot.currency };
            }
            catch (retryError) {
                error = retryError;
            }
        }
        const status = error instanceof client_1.PayPalApiError
            ? error.status
            : (error?.status ?? (error?.message?.includes("403") ? 403 : error?.message?.includes("404") ? 404 : undefined));
        let message;
        if (status === 403 || status === 404 || error?.message?.includes("insufficient permissions") || error?.message?.includes("NOT_AUTHORIZED")) {
            message = "Balance not verified: PayPal reporting permission not granted";
        }
        else {
            message = `Balance not verified: ${error instanceof Error ? error.message : String(error)}`;
        }
        try {
            const evidence = await readEvidence(caseId).catch(() => ({ caseId, milestones: {}, updatedAt: new Date().toISOString() }));
            evidence.moneyChecks ??= {};
            evidence.moneyChecks.businessBalanceAfterRelease = {
                verified: false,
                httpStatus: status ?? 403,
                message
            };
            await writeEvidence(evidence);
        }
        catch {
            // do not block the rest of the flow
        }
        return { verified: false, message };
    }
}
