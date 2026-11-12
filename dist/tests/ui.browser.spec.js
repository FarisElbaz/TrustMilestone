"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const user = (role) => ({
    user: { id: 1, name: `${role} user`, email: `${role}@example.test`, role, paypalEmail: `${role}@sandbox.test` },
    csrf: "browser-csrf"
});
async function mockApi(page, role, options = {}) {
    const criteriaStatus = options.criteriaStatus ?? "proposed";
    await page.route("**/health", (route) => route.fulfill({ json: { status: "ok" }, headers: { "x-csrf-token": "browser-csrf" } }));
    await page.route("**/api/auth/me", (route) => route.fulfill({ json: user(role) }));
    await page.route("**/api/auth/status", (route) => route.fulfill({ json: { ...user(role), authenticated: true } }));
    await page.route("**/api/auth/login", (route) => route.fulfill({ json: user(role), headers: { "x-csrf-token": "browser-csrf" } }));
    await page.route("**/api/cases", (route) => route.fulfill({ json: [{ id: "case-104", brief: "Build a reconciliation worker", stack: "Node 20", status: "created" }] }));
    // Case 104 is owned by user id 1 when signed in as the client; the worker mock gets a different owner.
    await page.route("**/api/cases/case-104", (route) => route.fulfill({ json: {
            id: "case-104", ownerId: role === "client" ? 1 : 2, workerId: role === "worker" ? 1 : 3,
            brief: "Build a reconciliation worker", stack: "Node 20", status: "escalate",
            worker: { name: "Assigned Worker", paypalEmail: "contractor@sandbox.test" },
            criteria: { status: criteriaStatus, criteria: [{ id: "C1", criterion: "Tests pass", method: "test" }], open_questions: [] },
            payment: { amount: "10.00", currency: "USD", authorizationId: "auth-mock-123" },
            verification: { decision: "escalate", outcomes: [{ id: "C1", method: "code_review", result: "unclear", reason: "Model disagreement" }] },
            decision: { decision: "escalate", reason: "Criteria evaluation was inconclusive." },
            review: { status: "pending" }
        } }));
    await page.route("**/api/cases/case-104/timeline", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/cases/case-104/review", async (route) => {
        if (route.request().method() === "POST") {
            const postData = route.request().postDataJSON();
            options.onReviewPost?.(postData);
            await route.fulfill({ json: { status: "resolved", decision: postData?.decision ?? "release" } });
        }
        else {
            await route.fallback();
        }
    });
}
test_1.test.describe("Milestone desk browser behavior", () => {
    (0, test_1.test)("signs in as each role", async ({ page }) => {
        for (const role of ["client", "worker"]) {
            await mockApi(page, role);
            await page.goto("/");
            await page.evaluate(() => localStorage.removeItem("session-active"));
            await page.goto("/");
            await page.locator("#auth-email").fill(`${role}@example.test`);
            await page.locator("#auth-password").fill("correct horse battery");
            await page.getByRole("button", { name: "Sign in" }).click();
            await (0, test_1.expect)(page.getByText(`${role} user · ${role}`)).toBeVisible();
        }
    });
    (0, test_1.test)("shows the stepper and the disabled funding reason", async ({ page }) => {
        await mockApi(page, "client", { criteriaStatus: "proposed" });
        await page.addInitScript(() => localStorage.setItem("session-active", "1"));
        await page.goto("/");
        await (0, test_1.expect)(page.locator("#user-label")).toBeVisible();
        await page.getByRole("button", { name: "case-104" }).click();
        await (0, test_1.expect)(page.getByRole("heading", { name: "Funding" })).toBeVisible();
        await (0, test_1.expect)(page.getByRole("button", { name: "Create authorization" })).toBeDisabled();
        await (0, test_1.expect)(page.getByText("Approve criteria before creating a buyer authorization.")).toBeVisible();
    });
    (0, test_1.test)("uncertain case asks the owning client to decide, with unclear verdicts visible", async ({ page }) => {
        await mockApi(page, "client");
        await page.addInitScript(() => localStorage.setItem("session-active", "1"));
        await page.goto("/");
        await page.getByRole("button", { name: "case-104" }).click();
        await (0, test_1.expect)(page.getByText("Your decision is needed.")).toBeVisible();
        await (0, test_1.expect)(page.getByText("unclear", { exact: true })).toBeVisible();
        await (0, test_1.expect)(page.getByRole("button", { name: "Accept delivery" })).toBeVisible();
        await (0, test_1.expect)(page.getByRole("button", { name: "Decline delivery" })).toBeVisible();
        await (0, test_1.expect)(page.getByRole("button", { name: "Reviewer queue" })).toHaveCount(0);
    });
    (0, test_1.test)("worker sees the pending decision but cannot accept or decline", async ({ page }) => {
        await mockApi(page, "worker");
        await page.addInitScript(() => localStorage.setItem("session-active", "1"));
        await page.goto("/");
        await page.getByRole("button", { name: "case-104" }).click();
        await (0, test_1.expect)(page.getByText("Waiting for the client to accept or decline the delivery.")).toBeVisible();
        await (0, test_1.expect)(page.getByRole("button", { name: "Accept delivery" })).toHaveCount(0);
    });
    (0, test_1.test)("requires confirmation stating amount and contractor before the client accepts", async ({ page }) => {
        let reviewCalledWith = null;
        await mockApi(page, "client", { onReviewPost: (body) => { reviewCalledWith = body; } });
        await page.addInitScript(() => localStorage.setItem("session-active", "1"));
        await page.goto("/");
        await page.getByRole("button", { name: "case-104" }).click();
        await page.getByRole("button", { name: "Accept delivery" }).click();
        const dialog = page.getByRole("dialog");
        await (0, test_1.expect)(dialog).toBeVisible();
        await (0, test_1.expect)(dialog).toContainText("Accept delivery?");
        await (0, test_1.expect)(dialog).toContainText("10.00 USD");
        await (0, test_1.expect)(dialog).toContainText("contractor@sandbox.test");
        await (0, test_1.expect)(dialog).toContainText("captures the authorization, then pays the contractor");
        await page.getByRole("button", { name: "Go back" }).click();
        await (0, test_1.expect)(dialog).not.toBeVisible();
        (0, test_1.expect)(reviewCalledWith).toBeNull();
        await page.getByRole("button", { name: "Accept delivery" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await (0, test_1.expect)(dialog).not.toBeVisible();
        (0, test_1.expect)(reviewCalledWith).toEqual({ decision: "release" });
    });
    (0, test_1.test)("requires confirmation stating void consequence before the client declines", async ({ page }) => {
        let reviewCalledWith = null;
        await mockApi(page, "client", { onReviewPost: (body) => { reviewCalledWith = body; } });
        await page.addInitScript(() => localStorage.setItem("session-active", "1"));
        await page.goto("/");
        await page.getByRole("button", { name: "case-104" }).click();
        await page.getByRole("button", { name: "Decline delivery" }).click();
        const dialog = page.getByRole("dialog");
        await (0, test_1.expect)(dialog).toBeVisible();
        await (0, test_1.expect)(dialog).toContainText("Decline delivery?");
        await (0, test_1.expect)(dialog).toContainText("voids the authorization and does not pay the contractor");
        await page.getByRole("button", { name: "Go back" }).click();
        await (0, test_1.expect)(dialog).not.toBeVisible();
        (0, test_1.expect)(reviewCalledWith).toBeNull();
        await page.getByRole("button", { name: "Decline delivery" }).click();
        await page.getByRole("button", { name: "Confirm" }).click();
        await (0, test_1.expect)(dialog).not.toBeVisible();
        (0, test_1.expect)(reviewCalledWith).toEqual({ decision: "reject" });
    });
    (0, test_1.test)("has no horizontal overflow at 360px", async ({ page }) => {
        await mockApi(page, "client");
        await page.setViewportSize({ width: 360, height: 800 });
        await page.goto("/");
        await test_1.expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
    (0, test_1.test)("front-end check on the release case: stages show recorded status with no console errors", async ({ page }) => {
        const consoleErrors = [];
        page.on("console", (msg) => {
            if (msg.type() === "error") {
                consoleErrors.push(msg.text());
            }
        });
        page.on("pageerror", (err) => {
            consoleErrors.push(err.message);
        });
        // Sign in as client to the real backend
        await page.goto("/");
        await page.locator("#auth-email").fill("release-ui-client@example.test");
        await page.locator("#auth-password").fill("correct horse battery");
        await page.getByRole("button", { name: "Sign in" }).click();
        await (0, test_1.expect)(page.getByText("release-run")).toBeVisible();
        // Open the release-run case
        await page.getByRole("button", { name: "release-run" }).click();
        await (0, test_1.expect)(page.getByRole("heading", { name: "release-run" })).toBeVisible();
        // Verify all 7 stages exist and display their recorded statuses
        const steps = page.locator(".step");
        await (0, test_1.expect)(steps).toHaveCount(7);
        // Brief
        await (0, test_1.expect)(steps.nth(0).getByRole("heading", { name: "Brief" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(0).getByText("Build a Node 20 Express TypeScript REST order endpoint.")).toBeVisible();
        // Criteria
        await (0, test_1.expect)(steps.nth(1).getByRole("heading", { name: "Criteria" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(1).getByText("Criteria are approved.")).toBeVisible();
        // Funding
        await (0, test_1.expect)(steps.nth(2).getByRole("heading", { name: "Funding" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(2).getByText("98A64427EH883704U")).toBeVisible();
        await (0, test_1.expect)(steps.nth(2).getByText("10.00 USD")).toBeVisible();
        // Submission
        await (0, test_1.expect)(steps.nth(3).getByRole("heading", { name: "Submission" })).toBeVisible();
        // Verification
        await (0, test_1.expect)(steps.nth(4).getByRole("heading", { name: "Verification" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(4).getByText("C2")).toBeVisible();
        await (0, test_1.expect)(steps.nth(4).getByText("pass").first()).toBeVisible();
        // Decision
        await (0, test_1.expect)(steps.nth(5).getByRole("heading", { name: "Decision" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(5).getByText("release", { exact: true })).toBeVisible();
        // Payout
        await (0, test_1.expect)(steps.nth(6).getByRole("heading", { name: "Payout" })).toBeVisible();
        await (0, test_1.expect)(steps.nth(6).getByText("2DN98015P3235063B")).toBeVisible();
        await (0, test_1.expect)(steps.nth(6).getByText("7WGSM54P5XMVQ")).toBeVisible();
        await (0, test_1.expect)(steps.nth(6).getByText("pending", { exact: true })).toBeVisible();
        await (0, test_1.expect)(steps.nth(6).getByText("4999.00 USD (verified)")).toBeVisible();
        // Ensure no console errors occurred
        (0, test_1.expect)(consoleErrors).toHaveLength(0);
        // Save screenshots for desktop (1440px) and mobile (360px)
        const screenshotsDir = node_path_1.default.resolve("docs", "screenshots");
        await promises_1.default.mkdir(screenshotsDir, { recursive: true });
        // Desktop view (1440x900)
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({ path: node_path_1.default.join(screenshotsDir, "release-run-1440.png"), fullPage: true });
        // Step-by-step screenshots at 1440
        const stepNames = ["brief", "criteria", "funding", "submission", "verification", "decision", "payout"];
        for (let i = 0; i < stepNames.length; i++) {
            const stepEl = steps.nth(i);
            await stepEl.scrollIntoViewIfNeeded();
            await stepEl.screenshot({ path: node_path_1.default.join(screenshotsDir, `release-run-${stepNames[i]}-1440.png`) });
        }
        // Mobile view (360x800)
        await page.setViewportSize({ width: 360, height: 800 });
        await page.screenshot({ path: node_path_1.default.join(screenshotsDir, "release-run-360.png"), fullPage: true });
        for (let i = 0; i < stepNames.length; i++) {
            const stepEl = steps.nth(i);
            await stepEl.scrollIntoViewIfNeeded();
            await stepEl.screenshot({ path: node_path_1.default.join(screenshotsDir, `release-run-${stepNames[i]}-360.png`) });
        }
    });
});
