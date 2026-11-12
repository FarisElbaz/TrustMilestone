# Project Overview & Claude Guide: Delivery Verifier (PayPalAI)

An automated milestone delivery verification and payment system integrating PayPal Sandbox and Google Gemini AI.

---

## Architecture & File Map

### Core Application (`src/`)

- **`src/app.ts`**: Main Express API server.
  - Role-based auth (`client`, `worker`, `reviewer`) with session & CSRF guards.
  - Case creation from template cases (`testset/cases/c01`-`c08`).
  - Worker upload handler (multipart/zip with streaming, EPERM fallback, path-traversal protection).
  - Triggers verification, payout, and review escalation endpoints.
- **`src/verify.ts`**: Verification orchestrator.
  - Runs automated test suite via sandbox and code-review criteria via AI judge.
  - Maps test assertions (`// REQ-n`) through `manifest.json` requirements and criterion text.
  - Evaluates criteria outcomes to route decision: `release` (funds released), `reject` (authorization voided), or `escalate` (human review).
- **`src/sandbox.ts`**: Test runner sandbox.
  - Copies submission files and test files into a dedicated `%TEMP%` directory.
  - Hoists nested single-folder uploads (e.g. `V1_correct/src/app.ts`).
  - Resolves config files (`package.json`, `tsconfig.json`, `jest.config.js`) from template references.
  - Executes `npm install --ignore-scripts` and `npm test -- --json`, parsing test assertion results and requirement IDs.
- **`src/judge.ts`**: AI Code Review Judge.
  - Executes 3 independent Gemini calls at temperature 0 to evaluate `code_review` criteria.
  - Requires unanimous agreement across all 3 runs to decide `pass` or `fail`; otherwise returns `unclear`.
- **`src/criteria.ts` & `src/criteria-approval.ts`**:
  - LLM-assisted criteria generation from project briefs.
  - Stores proposal and approval states in `out/<caseId>/criteria.json`.
- **`src/milestone.ts`**:
  - Manages PayPal order authorization, capture, void, and payout state machines.
  - Enforces duplicate authorization guards, cumulative amount limits, and post-capture void locks.
- **`src/review-handoff.ts`**:
  - Writes escalation handoff files (`review.json` and `review.md`) for human reviewers when criteria are ambiguous.
  - Handles manual reviewer release/reject decisions.
- **`src/paths.ts`**:
  - Centralized path resolver for `outputRoot()` (respects `process.env.OUTPUT_ROOT` for test isolation).
- **`src/database.ts`**:
  - SQLite singleton managing users, cases, submissions, verifications, payouts, and events.
- **`src/ui-server.ts`**:
  - Serves the Milestone Desk frontend operations console and static assets (`public/`).

### PayPal Integration (`src/paypal/`)

- **`src/paypal/client.ts`**: Low-level PayPal OAuth2 client (Bearer token caching, timeouts, retry backoff for 5xx).
- **`src/paypal/orders.ts`**: Orders v2 API (authorizations via sandbox test card or manual buyer approval URL).
- **`src/paypal/payments.ts`**: Payouts API and authorization voiding.
- **`src/paypal/evidence.ts`**: Records audit trail in `evidence.json` and checks business reporting balances.
- **`src/paypal/config.ts`**: Environment validation for sandbox credentials and currency.

### Fixtures & Tests

- **`testset/cases/`**: Standardized evaluation templates (`c01` to `c08`) containing `brief.md`, `manifest.json`, `reference/` implementation, and bug `variants/`.
- **`tests/`**: 14 Jest test suites (69 tests). All test suites use isolated temporary directories for database and output artifacts.

---

## Known Issues & Watch-Outs

### 2. Criterion-to-Test Mapping for Multi-Criterion Templates
- **Issue**: Previously, `verify.ts` relied on simple string replacement (`C<n>` -> `REQ-<n>`). When a case had more criteria than manifest requirements (e.g. `c02` has criteria C2, C3, C4 but only REQ-1 and REQ-2), criteria mapped to nonexistent IDs and became `unclear`.
- **Remedy**: Map criteria through the case `manifest.json` requirements list using keyword overlap, falling back to matching criterion text against test names.

### 3. Nested Folder Submissions in the Sandbox Runner
- **Issue**: When workers upload submissions as folders or archives, files may be wrapped in a root folder (e.g., `data/submissions/<caseId>/V1_correct/src/app.ts`). If copied directly, Jest tests looking for `../src/app` fail with `MODULE_NOT_FOUND`.
- **Remedy**: The sandbox runner checks for missing root code and hoists inner directories containing `src/` or `package.json`.

### 4. PayPal Sandbox Reporting Scope (403 on Balances)
- **Issue**: Calling `/v1/reporting/balances` often returns HTTP 403 `NOT_AUTHORIZED` if the PayPal developer dashboard credentials lack balance reporting scopes.
- **Remedy**: Handled gracefully — marks `Balance not verified: PayPal reporting permission not granted` in `evidence.json` and UI without blocking milestone delivery.

### 5. Loopback TCP Port Binding in Standard Sandbox
- **Issue**: The agent sandbox isolates loopback network sockets. Express HTTP tests (`app.test.ts`, `ui-server.test.ts`) require elevated permissions (`BypassSandbox: true` / outside sandbox) to bind a port.

---

## Common Development Commands

```bash
# Build TypeScript
npm run build

# Run unit and integration tests (in-band)
npm test

# Run UI dev server
npm run ui
```
