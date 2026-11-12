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
reviewer queue, worker upload flow, and accessible status/error announcements.
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

Workflow:

1. Sign up as a client, worker, or reviewer.
2. The client creates a case and assigns a worker by account email.
3. Generate, review, and approve criteria, then fund the case.
4. Open the PayPal approval link as the client and check status.
5. The assigned worker uploads a folder or ZIP (maximum 50 MB) and runs verification.
6. Release, reject, or escalate follows the existing routing; reviewers resolve escalations.

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
npm run review -- --case c01 --decision release
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
