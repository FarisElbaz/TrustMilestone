"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.milestone = void 0;
exports.getPaymentRecord = getPaymentRecord;
exports.markNeedsReview = markNeedsReview;
exports.fundCase = fundCase;
exports.paymentStatus = paymentStatus;
exports.releaseMilestone = releaseMilestone;
exports.rejectMilestone = rejectMilestone;
exports.holdMilestone = holdMilestone;
exports.resolveReview = resolveReview;
exports.refreshPayoutStatus = refreshPayoutStatus;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("./paypal/config");
const orders_1 = require("./paypal/orders");
const payments_1 = require("./paypal/payments");
const paymentMode = () => process.env.PAYMENT_MODE ?? "mock";
const recordPath = (caseId) => node_path_1.default.resolve("out", caseId, "paypal.json");
const known = {
    order: new Set(["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "COMPLETED"]),
    authorization: new Set(["CREATED", "AUTHORIZED", "PARTIALLY_CAPTURED", "CAPTURED", "VOIDED", "EXPIRED"]),
    capture: new Set(["COMPLETED", "PENDING", "REFUNDED", "PARTIALLY_REFUNDED"]),
    payout: new Set(["PENDING", "PROCESSING", "SUCCESS", "DENIED", "CANCELED"])
};
const readRecord = async (caseId) => {
    try {
        const record = JSON.parse(await promises_1.default.readFile(recordPath(caseId), "utf8"));
        record.milestones ??= [];
        record.paypalResponses ??= [];
        return record;
    }
    catch (error) {
        if (error.code === "ENOENT")
            throw new Error(`No PayPal record exists for case ${caseId}.`);
        throw new Error(`Unable to read PayPal record for ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
};
async function getPaymentRecord(caseId) { return readRecord(caseId); }
const writeRecord = async (record) => {
    await promises_1.default.mkdir(node_path_1.default.dirname(recordPath(record.caseId)), { recursive: true });
    await promises_1.default.writeFile(recordPath(record.caseId), JSON.stringify(record, null, 2));
};
async function markNeedsReview(caseId, reason) {
    const record = await readRecord(caseId);
    record.needsReview = reason;
    await writeRecord(record);
    return record;
}
const cents = (value) => Math.round(Number(value) * 100);
function validateMoney(amount, currency) {
    const problems = [...(0, config_1.validateAmount)(amount), ...(0, config_1.validateCurrency)(currency).map((problem) => problem.replace("PAYPAL_CURRENCY", "currency"))];
    if (problems.length)
        throw new Error(problems.join("\n"));
}
function assertSandbox() { (0, config_1.validatePaymentEnvironment)(); }
function observe(record, operation, status, category) {
    record.paypalResponses ??= [];
    record.paypalResponses.push({ operation, status, recordedAt: new Date().toISOString() });
    if (!known[category].has(status)) {
        record.needsReview = `Unknown PayPal ${category} status: ${status}`;
        throw new Error(record.needsReview);
    }
}
function assertCaseId(caseId) {
    if (!/^[A-Za-z0-9._-]+$/.test(caseId))
        throw new Error("Invalid case ID.");
}
async function fundCase(caseId, amount, currency = process.env.PAYPAL_CURRENCY ?? "USD") {
    assertCaseId(caseId);
    validateMoney(amount, currency);
    try {
        const existing = await readRecord(caseId);
        if (!existing.voidedAt && existing.milestones.length === 0)
            return existing;
    }
    catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("No PayPal record"))
            throw error;
    }
    const record = { caseId, amount, currency, createdAt: new Date().toISOString(), milestones: [], paypalResponses: [] };
    if (paymentMode() === "mock") {
        record.authorizationId = `mock-auth-${caseId}`;
        record.authorizedAt = record.createdAt;
        record.authorizationStatus = "AUTHORIZED";
        record.authorizationExpirationTime = new Date(Date.now() + 29 * 86400000).toISOString();
    }
    else {
        assertSandbox();
        const order = await (0, orders_1.createAuthorizeOrder)(amount, currency, caseId);
        record.orderId = order.orderId;
        record.approvalUrl = order.approvalUrl;
        record.orderStatus = "CREATED";
        observe(record, "create-order", record.orderStatus, "order");
    }
    await writeRecord(record);
    return record;
}
async function paymentStatus(caseId) {
    const record = await readRecord(caseId);
    if (paymentMode() === "mock")
        return record;
    assertSandbox();
    if (record.authorizationId)
        return record;
    if (!record.orderId)
        throw new Error(`No PayPal order is recorded for ${caseId}.`);
    const order = await (0, orders_1.getOrder)(record.orderId);
    record.orderStatus = order.status;
    observe(record, "show-order", order.status, "order");
    if (order.payerEmail && process.env.PAYPAL_BUYER_EMAIL && order.payerEmail.toLowerCase() !== process.env.PAYPAL_BUYER_EMAIL.toLowerCase()) {
        await writeRecord(record);
        throw new Error("PayPal payer email does not match PAYPAL_BUYER_EMAIL.");
    }
    if (order.status !== "APPROVED") {
        await writeRecord(record);
        throw new Error(`PayPal order ${record.orderId} is not approved (status: ${order.status}).`);
    }
    const authorization = await (0, orders_1.authorizeOrder)(record.orderId);
    if (!authorization.authorizationId || !authorization.expirationTime)
        throw new Error("PayPal authorization response did not include ID and expiration_time.");
    record.authorizationId = authorization.authorizationId;
    record.authorizedAt = new Date().toISOString();
    record.authorizationStatus = authorization.status ?? "UNKNOWN";
    record.authorizationResponseStatus = record.authorizationStatus;
    record.authorizationExpirationTime = authorization.expirationTime;
    record.authorizationAmount = authorization.amount?.value;
    record.authorizationCurrency = authorization.amount?.currency_code;
    observe(record, "authorize-order", record.authorizationStatus, "authorization");
    await writeRecord(record);
    return record;
}
async function requireAuthorized(caseId) {
    const record = await readRecord(caseId);
    if (record.needsReview)
        throw new Error(`Case ${caseId} needs review: ${record.needsReview}`);
    if (!record.authorizationId || !record.authorizedAt)
        throw new Error(`No recorded authorization for ${caseId}; run payment:status after buyer approval.`);
    if (record.authorizationStatus === "VOIDED")
        throw new Error(`Authorization for ${caseId} was voided.`);
    const expiry = record.authorizationExpirationTime ?? (paymentMode() === "mock" ? new Date(new Date(record.authorizedAt).getTime() + 29 * 86400000).toISOString() : undefined);
    if (!expiry || Date.now() >= new Date(expiry).getTime())
        throw new Error(`Authorization for ${caseId} has expired.`);
    return record;
}
async function releaseMilestone(caseId, amount, milestoneNumber = 1) {
    const record = await requireAuthorized(caseId);
    validateMoney(amount, record.currency);
    if (record.milestones.some((item) => item.number === milestoneNumber))
        throw new Error(`Milestone ${milestoneNumber} has already been recorded.`);
    if (record.currency !== (record.authorizationCurrency ?? record.currency))
        throw new Error("Currency differs from the authorized order.");
    if (cents(record.milestones.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2)) + cents(amount) > cents(record.amount))
        throw new Error("Milestone total exceeds the authorized amount.");
    const item = { number: milestoneNumber, amount, status: "pending", timestamp: new Date().toISOString() };
    if (paymentMode() === "mock")
        item.status = "released";
    else {
        assertSandbox();
        if (record.authorizationAmount && cents(amount) > cents(record.authorizationAmount))
            throw new Error("Capture exceeds the authorized amount.");
        const capture = await (0, orders_1.captureAuthorization)(record.authorizationId, amount, record.currency);
        item.captureId = capture.captureId;
        item.invoiceId = capture.invoiceId;
        item.captureStatus = capture.status;
        if (!capture.captureId || !capture.status)
            throw new Error("PayPal capture response was incomplete.");
        observe(record, "capture", capture.status, "capture");
        record.milestones.push(item);
        await writeRecord(record);
        const submittedPayout = await (0, payments_1.sendPayout)(caseId, process.env.PAYPAL_CONTRACTOR_EMAIL ?? "", amount, record.currency, milestoneNumber);
        if (!submittedPayout.batchId || !submittedPayout.batchStatus)
            throw new Error("PayPal payout response was incomplete.");
        item.payoutBatchId = submittedPayout.batchId;
        item.payoutStatus = submittedPayout.batchStatus;
        await writeRecord(record);
        const payout = await (0, payments_1.waitForPayout)(submittedPayout.batchId);
        item.payoutStatus = payout.batchStatus;
        item.payoutItemStatuses = payout.itemStatuses;
        if (payout.itemStatuses.includes("UNCLAIMED"))
            item.payoutNote = "Contractor sandbox recipient has no PayPal account configured.";
        if (!payout.batchStatus)
            throw new Error("PayPal payout status response was incomplete.");
        observe(record, "payout", payout.batchStatus, "payout");
        item.status = "released";
        await writeRecord(record);
        return;
    }
    record.milestones.push(item);
    await writeRecord(record);
}
async function rejectMilestone(caseId) {
    const record = await requireAuthorized(caseId);
    if (record.milestones.length)
        throw new Error("Cannot void an authorization after capture.");
    if (paymentMode() !== "mock") {
        assertSandbox();
        await (0, payments_1.voidAuthorization)(record.authorizationId);
    }
    record.authorizationStatus = "VOIDED";
    record.voidedAt = new Date().toISOString();
    await writeRecord(record);
}
async function holdMilestone(caseId, deadline) {
    const record = await requireAuthorized(caseId);
    record.escalation = { deadline: new Date(deadline).toISOString(), recordedAt: new Date().toISOString() };
    record.hold = { deadline: record.escalation.deadline, recordedAt: record.escalation.recordedAt };
    await writeRecord(record);
}
async function resolveReview(caseId, decision) {
    const record = await requireAuthorized(caseId);
    if (!record.escalation || record.escalation.resolvedAt)
        throw new Error("No unresolved escalation exists for this case.");
    if (new Date(record.escalation.deadline).getTime() < Date.now())
        throw new Error("The escalation deadline has expired.");
    if (decision === "release")
        await releaseMilestone(caseId, record.amount, 1);
    else
        await rejectMilestone(caseId);
    record.escalation = { ...record.escalation, resolvedAt: new Date().toISOString(), decision };
    await writeRecord(record);
}
async function refreshPayoutStatus(caseId, milestoneNumber = 1) {
    const record = await readRecord(caseId);
    const milestone = record.milestones.find((item) => item.number === milestoneNumber);
    if (!milestone?.payoutBatchId || paymentMode() === "mock")
        return milestone?.payoutStatus;
    const payout = await (0, payments_1.getPayout)(milestone.payoutBatchId);
    milestone.payoutStatus = payout.batchStatus;
    milestone.payoutItemStatuses = payout.itemStatuses;
    if (payout.batchStatus)
        observe(record, "payout-status", payout.batchStatus, "payout");
    await writeRecord(record);
    return milestone.payoutStatus;
}
exports.milestone = { releaseMilestone, holdMilestone, rejectMilestone };
