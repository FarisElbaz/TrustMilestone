import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const user = (role: "client" | "worker" | "reviewer") => ({
  user: { id: 1, name: `${role} user`, email: `${role}@example.test`, role, paypalEmail: `${role}@sandbox.test` },
  csrf: "browser-csrf"
});

async function mockApi(
  page: Page,
  role: "client" | "worker" | "reviewer",
  options: { criteriaStatus?: "proposed" | "approved"; onReviewPost?: (body: unknown) => void } = {}
) {
  const criteriaStatus = options.criteriaStatus ?? "proposed";
  await page.route("**/health", (route) => route.fulfill({ json: { status: "ok" }, headers: { "x-csrf-token": "browser-csrf" } }));
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: user(role) }));
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { ...user(role), authenticated: true } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: user(role), headers: { "x-csrf-token": "browser-csrf" } }));
  await page.route("**/api/cases", (route) => route.fulfill({ json: [{ id: "case-104", brief: "Build a reconciliation worker", stack: "Node 20", status: "created" }] }));
  await page.route("**/api/cases/case-104", (route) => route.fulfill({ json: {
    id: "case-104", brief: "Build a reconciliation worker", stack: "Node 20", status: "escalated",
    worker: { name: "Assigned Worker", paypalEmail: "contractor@sandbox.test" },
    criteria: { status: criteriaStatus, criteria: [{ id: "C1", criterion: "Tests pass", method: "test" }], open_questions: [] },
    payment: { amount: "10.00", currency: "USD", authorizationId: "auth-mock-123" },
    decision: { decision: "escalate", reason: "Criteria evaluation was inconclusive." }
  } }));
  await page.route("**/api/cases/case-104/timeline", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/reviews/queue", (route) => route.fulfill({ json: [{
    id: "case-104",
    decision: "escalated",
    timeRemaining: "6h 20m",
    criteria: [{ id: "C1", verdict: "unclear", reason: "Model disagreement", evidence: [] }]
  }] }));
  await page.route("**/api/cases/case-104/review", async (route) => {
    if (route.request().method() === "POST") {
      const postData = route.request().postDataJSON();
      options.onReviewPost?.(postData);
      await route.fulfill({ json: { status: "resolved", decision: postData?.decision ?? "release" } });
    } else {
      await route.fallback();
    }
  });
}

test.describe("Milestone desk browser behavior", () => {
  test("signs in as each role", async ({ page }) => {
    for (const role of ["client", "worker", "reviewer"] as const) {
      await mockApi(page, role);
      await page.goto("/");
      await page.evaluate(() => localStorage.removeItem("session-active"));
      await page.goto("/");
      await page.locator("#auth-email").fill(`${role}@example.test`);
      await page.locator("#auth-password").fill("correct horse battery");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByText(`${role} user · ${role}`)).toBeVisible();
    }
  });

  test("shows the stepper and the disabled funding reason", async ({ page }) => {
    await mockApi(page, "client", { criteriaStatus: "proposed" });
    await page.addInitScript(() => localStorage.setItem("session-active", "1"));
    await page.goto("/");
    await expect(page.locator("#user-label")).toBeVisible();
    await page.getByRole("button", { name: "case-104" }).click();
    await expect(page.getByRole("heading", { name: "Funding" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create authorization" })).toBeDisabled();
    await expect(page.getByText("Approve criteria before creating a buyer authorization.")).toBeVisible();
  });

  test("uncertain model case appears in reviewer queue with unclear verdicts", async ({ page }) => {
    await mockApi(page, "reviewer");
    await page.addInitScript(() => localStorage.setItem("session-active", "1"));
    await page.goto("/");
    await expect(page.locator("#user-label")).toBeVisible();
    await page.getByRole("button", { name: "Reviewer queue" }).click();
    await expect(page.getByRole("heading", { name: "Reviewer queue" })).toBeVisible();
    await expect(page.locator("#review-table").getByText("case-104")).toBeVisible();
    await expect(page.locator("#review-table").getByText("escalated", { exact: true })).toBeVisible();
    await expect(page.locator("#review-table").getByText("6h 20m")).toBeVisible();
    await expect(page.locator("#review-table").getByText("C1")).toBeVisible();
    await expect(page.locator("#review-table").getByText("unclear", { exact: true })).toBeVisible();
  });

  test("requires confirmation stating amount and contractor before reviewer release", async ({ page }) => {
    let reviewCalledWith: unknown = null;
    await mockApi(page, "reviewer", { onReviewPost: (body) => { reviewCalledWith = body; } });
    await page.addInitScript(() => localStorage.setItem("session-active", "1"));
    await page.goto("/");
    await expect(page.locator("#user-label")).toBeVisible();
    await page.getByRole("button", { name: "Reviewer queue" }).click();
    await expect(page.locator("#review-table").getByText("case-104")).toBeVisible();
    await page.locator("#review-table").getByRole("button", { name: "Review" }).click();

    await expect(page.getByRole("button", { name: "Release milestone" })).toBeVisible();
    await page.getByRole("button", { name: "Release milestone" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Release milestone?");
    await expect(dialog).toContainText("10.00 USD");
    await expect(dialog).toContainText("contractor@sandbox.test");
    await expect(dialog).toContainText("captures the authorization, then pays the contractor");

    // Click Go back - confirmation cancelled, call must not run
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).not.toBeVisible();
    expect(reviewCalledWith).toBeNull();

    // Open again and confirm
    await page.getByRole("button", { name: "Release milestone" }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).not.toBeVisible();
    expect(reviewCalledWith).toEqual({ decision: "release" });
  });

  test("requires confirmation stating void consequence before reviewer reject", async ({ page }) => {
    let reviewCalledWith: unknown = null;
    await mockApi(page, "reviewer", { onReviewPost: (body) => { reviewCalledWith = body; } });
    await page.addInitScript(() => localStorage.setItem("session-active", "1"));
    await page.goto("/");
    await expect(page.locator("#user-label")).toBeVisible();
    await page.getByRole("button", { name: "case-104" }).click();

    await expect(page.getByRole("button", { name: "Reject milestone" })).toBeVisible();
    await page.getByRole("button", { name: "Reject milestone" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Reject milestone?");
    await expect(dialog).toContainText("voids the authorization and does not pay the contractor");

    // Click Go back - confirmation cancelled, call must not run
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).not.toBeVisible();
    expect(reviewCalledWith).toBeNull();

    // Open again and confirm
    await page.getByRole("button", { name: "Reject milestone" }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).not.toBeVisible();
    expect(reviewCalledWith).toEqual({ decision: "reject" });
  });

  test("has no horizontal overflow at 360px", async ({ page }) => {
    await mockApi(page, "client");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("front-end check on the release case: stages show recorded status with no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
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
    await expect(page.getByText("release-run")).toBeVisible();

    // Open the release-run case
    await page.getByRole("button", { name: "release-run" }).click();
    await expect(page.getByRole("heading", { name: "release-run" })).toBeVisible();

    // Verify all 7 stages exist and display their recorded statuses
    const steps = page.locator(".step");
    await expect(steps).toHaveCount(7);

    // Brief
    await expect(steps.nth(0).getByRole("heading", { name: "Brief" })).toBeVisible();
    await expect(steps.nth(0).getByText("Build a Node 20 Express TypeScript REST order endpoint.")).toBeVisible();

    // Criteria
    await expect(steps.nth(1).getByRole("heading", { name: "Criteria" })).toBeVisible();
    await expect(steps.nth(1).getByText("Criteria are approved.")).toBeVisible();

    // Funding
    await expect(steps.nth(2).getByRole("heading", { name: "Funding" })).toBeVisible();
    await expect(steps.nth(2).getByText("98A64427EH883704U")).toBeVisible();
    await expect(steps.nth(2).getByText("10.00 USD")).toBeVisible();

    // Submission
    await expect(steps.nth(3).getByRole("heading", { name: "Submission" })).toBeVisible();

    // Verification
    await expect(steps.nth(4).getByRole("heading", { name: "Verification" })).toBeVisible();
    await expect(steps.nth(4).getByText("C2")).toBeVisible();
    await expect(steps.nth(4).getByText("pass").first()).toBeVisible();

    // Decision
    await expect(steps.nth(5).getByRole("heading", { name: "Decision" })).toBeVisible();
    await expect(steps.nth(5).getByText("release", { exact: true })).toBeVisible();

    // Payout
    await expect(steps.nth(6).getByRole("heading", { name: "Payout" })).toBeVisible();
    await expect(steps.nth(6).getByText("2DN98015P3235063B")).toBeVisible();
    await expect(steps.nth(6).getByText("7WGSM54P5XMVQ")).toBeVisible();
    await expect(steps.nth(6).getByText("pending", { exact: true })).toBeVisible();
    await expect(steps.nth(6).getByText("4999.00 USD (verified)")).toBeVisible();

    // Ensure no console errors occurred
    expect(consoleErrors).toHaveLength(0);

    // Save screenshots for desktop (1440px) and mobile (360px)
    const screenshotsDir = path.resolve("docs", "screenshots");
    await fs.mkdir(screenshotsDir, { recursive: true });

    // Desktop view (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: path.join(screenshotsDir, "release-run-1440.png"), fullPage: true });

    // Step-by-step screenshots at 1440
    const stepNames = ["brief", "criteria", "funding", "submission", "verification", "decision", "payout"];
    for (let i = 0; i < stepNames.length; i++) {
      const stepEl = steps.nth(i);
      await stepEl.scrollIntoViewIfNeeded();
      await stepEl.screenshot({ path: path.join(screenshotsDir, `release-run-${stepNames[i]}-1440.png`) });
    }

    // Mobile view (360x800)
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({ path: path.join(screenshotsDir, "release-run-360.png"), fullPage: true });

    for (let i = 0; i < stepNames.length; i++) {
      const stepEl = steps.nth(i);
      await stepEl.scrollIntoViewIfNeeded();
      await stepEl.screenshot({ path: path.join(screenshotsDir, `release-run-${stepNames[i]}-360.png`) });
    }
  });
});
