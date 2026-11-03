"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAmount = validateAmount;
exports.validateCurrency = validateCurrency;
exports.validatePaymentEnvironment = validatePaymentEnvironment;
const env_1 = require("../env");
(0, env_1.loadEnvironment)();
const CURRENCY_CODES = new Set([
    "AUD", "BRL", "CAD", "CHF", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF",
    "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SGD", "THB",
    "TRY", "TWD", "USD"
]);
function validateAmount(value) {
    return /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) && Number(value) > 0
        ? [] : ["PAYPAL_AMOUNT must be a positive decimal with at most two places."];
}
function validateCurrency(value) {
    return /^[A-Z]{3}$/.test(value) && CURRENCY_CODES.has(value)
        ? [] : ["PAYPAL_CURRENCY must be a supported three-letter currency code."];
}
function validatePaymentEnvironment(options = {}) {
    if ((process.env.PAYMENT_MODE ?? "mock") === "mock")
        return;
    const problems = [];
    if (process.env.PAYMENT_MODE !== "sandbox")
        problems.push('PAYMENT_MODE must be "mock" or "sandbox".');
    if (process.env.PAYPAL_ENV !== "sandbox")
        problems.push('PAYPAL_ENV must be exactly "sandbox".');
    if ((process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com").replace(/\/+$/, "") !== "https://api-m.sandbox.paypal.com")
        problems.push("PAYPAL_API_BASE must be https://api-m.sandbox.paypal.com.");
    for (const name of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_BUYER_EMAIL", "PAYPAL_CONTRACTOR_EMAIL"]) {
        if (!process.env[name])
            problems.push(`${name} is required in sandbox mode.`);
    }
    if (options.requireAmount || process.env.PAYPAL_AMOUNT || options.amount)
        problems.push(...validateAmount(options.amount ?? process.env.PAYPAL_AMOUNT ?? ""));
    if (options.currency ?? process.env.PAYPAL_CURRENCY)
        problems.push(...validateCurrency(options.currency ?? process.env.PAYPAL_CURRENCY));
    else
        problems.push("PAYPAL_CURRENCY is required in sandbox mode.");
    if (problems.length)
        throw new Error(`Invalid PayPal configuration:\n- ${[...new Set(problems)].join("\n- ")}`);
}
