# Delivery verifier

## Setup

Requires Node 20 and `GEMINI_API_KEY` for non-mocked model calls.

```powershell
npm install
npm test
npx playwright test
```

## Hosted web application

The Express application keeps the existing single-page interface and adds
multi-user accounts, role checks, CSRF protection, security headers, and
SQLite persistence. PayPal credentials and the Gemini key are server-only.
PayPal operations remain sandbox-only.

The hosted interface is the Milestone desk operations console. See
[DESIGN.md](./DESIGN.md) for the visual and interaction direction. It supports
light and dark themes, responsive case tables, the full delivery stepper,
the client's accept/decline step for uncertain results, the worker upload flow,
and accessible status/error announcements.
Browser coverage lives in `tests/ui.browser.spec.ts`; Playwright starts the app
in mock payment mode for the suite. Reference screenshots are in
`docs/screenshots/`.

```powershell
npm run migrate
npm run build
npm start
```

Migration also runs when the app starts. The health check is `GET /health`.
Configure `PORT`, `SESSION_SECRET`, `DATABASE_PATH` (default
`./data/delivery-verifier.sqlite`), and `SUBMISSIONS_PATH` (default
`./data/submissions`). Set `SESSION_SECRET` to a long random value outside
development.

For sandbox payments set `PAYMENT_MODE=sandbox`, `PAYPAL_ENV=sandbox`,
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BUYER_EMAIL`, and
`PAYPAL_CONTRACTOR_EMAIL`. Set `GEMINI_API_KEY` for real criteria and review
calls. PayPal and Gemini secrets never reach the browser. The PayPal buyer and
contractor sandbox emails are also recorded on the matching user during
sign-up.

The server loads environment variables from `.env` in the project folder or,
if that is missing, from `trustmilestone/backend/.env`.

Workflow:

1. Sign up as a client or a worker. There are two roles; the reviewer role was removed.
2. The client creates a case from a template and assigns a worker by account
   email. The case ID must be new: an ID that is already taken, or that still
   has saved files under `out/<case-id>/`, is refused so a new case never
   inherits old criteria or payments.
3. The client generates criteria, can revise them, and approves them. Criteria
   are only approved by the client's **Approve criteria** click.
4. The client funds the case. **Fund case** uses sandbox card funding (no buyer
   login); **Fund with buyer approval** opens the PayPal approval link instead.
5. The assigned worker uploads a folder or ZIP (maximum 50 MB) and clicks
   **Run verification**. The file picker selects folders; to upload a ZIP,
   drag it onto the drop zone.
6. Verification routes the result:
   - **release**: every criterion passed. PayPal captures the authorization and
     pays the worker right away. Use **Refresh payout status** to follow the payout.
   - **reject**: at least one criterion failed. The authorization is voided.
   - **escalate**: nothing failed, but at least one criterion is uncertain
     (`unclear`). This happens when the three AI judge runs disagree, when a judge
     answer is malformed, or when a criterion has method `manual`. The money stays
     authorized, and the client sees **Your decision is needed** with
     **Accept delivery** (capture and pay the worker) or **Decline delivery**
     (void the authorization). Only the client who owns the case can decide; the
     worker sees that the decision is pending. The decision must be made before the
     PayPal authorization expires.

## AI models

Model settings live in `config/models.json`, or `trustmilestone/backend/config/models.json`
when the first file is missing. Each entry names a main `model` and optional
`fallback_models`:

```json
"code_review_judge": {
  "provider": "gemini",
  "model": "gemini-3.8-flash",
  "fallback_models": ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
  "temperature": 0,
  "response_format": "json"
}
```

If a model answers HTTP 404, 429, 500, or 503 (for example, "This model is
currently experiencing high demand"), the next model is tried; if all fail, the
whole list is tried once more after a short pause. Other errors stop immediately.

## Render deployment

`render.yaml` defines one Node 20 web service, the `/health` check, build/start
commands, a generated session secret, and secret environment variables. Connect
the repository in Render and mount a persistent disk at `/var/data` for SQLite
and submissions. Create one PayPal Sandbox personal buyer account and one
business/contractor account in the PayPal Developer Dashboard. Use their
sandbox email addresses when creating the client and worker accounts.

## Existing CLI and PayPal workflow

The original commands remain available:

```powershell
npm run verify -- --case testset/cases/c01 --submission testset/cases/c01/variants/V2_subtle_bug
npm run criteria -- --case c01
npm run fund -- --case c01 --amount 10.00 --currency USD
npm run payment:status -- --case c01
npm run review -- --case c01 --decision release   # resolves an escalated case from the CLI
npm run diagnose:orders
npm run test:live
```

The implementation refuses missing credentials, non-sandbox PayPal hosts, or
environments other than `sandbox`. Existing PayPal state files under
`out/<case-id>/` are retained for compatibility while hosted records are also
stored in SQLite. The live test creates its own sandbox `AUTHORIZE` order and
stores its ID in `out/live-test/paypal.json`; no manually supplied order ID is
needed. Approve the printed URL in the buyer sandbox account while the test
polls PayPal for approval.
