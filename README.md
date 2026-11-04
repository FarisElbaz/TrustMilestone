# Delivery verifier

## Setup

Requires Node 20 and `GEMINI_API_KEY` for non-mocked model calls.

```powershell
npm install
npm test
```

## Run

```powershell
npm run verify -- --case testset/cases/c01 --submission testset/cases/c01/variants/V2_subtle_bug
```

Criteria and routing results are written to `out/<case-id>/`. The sandbox prefers Docker with no network and a read-only mount; without Docker it uses a temporary directory, a restricted environment, a 120-second timeout, and the host process.

## PayPal sandbox

The default `PAYMENT_MODE=mock` writes milestone decisions locally. To use PayPal's
sandbox only, set `PAYMENT_MODE=sandbox`, `PAYPAL_ENV=sandbox`, and provide
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BUYER_EMAIL`, and
`PAYPAL_CONTRACTOR_EMAIL` as environment variables. The implementation refuses
missing credentials, any environment other than `sandbox`, and any host other
than `https://api-m.sandbox.paypal.com`.

Set optional `PAYPAL_AMOUNT` and `PAYPAL_CURRENCY` for verifier funding. Run
`npm run smoke:capture` to create an AUTHORIZE order, approve it as the buyer,
and capture a partial amount. The live script is intentionally separate:
`npm run test:live` skips unless all required variables are present. Never put
credentials in files or `NOTES.md`; funding and authorization state is stored in
`out/<case-id>/paypal.json`.

Run the sandbox workflow in this order:

```powershell
npm run criteria -- --case c01
npm run fund -- --case c01 --amount 10.00 --currency USD
npm run payment:status -- --case c01
npm run verify -- --case testset/cases/c01 --submission testset/cases/c01/reference
npm run review -- --case c01 --decision release
```

The criteria command asks the operator to approve or revise the LLM-generated
criteria. Verification refuses to run until `out/<case-id>/criteria.json` has
status `approved`. If verification escalates, it writes `review.json` and
`review.md`; inspect the summary with `npm run review -- --case c01`, then
resolve it with `--decision release` or `--decision reject`.

Approve the printed order URL as `PAYPAL_BUYER_EMAIL` before running
`payment:status`. The verifier then captures milestone 1 and sends the payout.
For an escalation, inspect and resolve it with:

```powershell
npm run review -- --case c01
npm run review -- --case c01 --decision release
```

`npm test` runs mocked tests. `npm run test:live` is separate, requires sandbox
credentials and manual buyer approvals, polls every 10 seconds for up to 15
minutes, and records observed PayPal statuses.

The same commands work in bash after exporting the variables:

```bash
export PAYMENT_MODE=sandbox PAYPAL_ENV=sandbox
export PAYPAL_CLIENT_ID='sandbox-client-id'
export PAYPAL_CLIENT_SECRET='sandbox-client-secret'
export PAYPAL_BUYER_EMAIL='buyer@example.test'
export PAYPAL_CONTRACTOR_EMAIL='contractor@example.test'
export PAYPAL_AMOUNT=10.00 PAYPAL_CURRENCY=USD
```

The demo remains file-backed: it has no web UI, accounts, database, webhook
listener, automatic contractor balance API check, or automatic retry-recovery
job. Escalations are resolved by the `review` command. PayPal Sandbox must be
used for live behavior; mock mode is the default for local tests.

The client ID and secret must come from the same **Sandbox REST app** in the
PayPal Developer Dashboard. They are not the buyer, contractor, or business
account password/email. The integration has no account provisioning, database,
webhook listener, automatic balance API, or background retry job in this phase.

The commands use state files under `out/<case-id>/`, so the criteria and review
services can be called from a future UI without coupling the UI to the CLI.

## Local web interface

The UI is a local demo only. It has no authentication and must not be exposed
outside the machine. It refuses to start unless `PAYPAL_ENV=sandbox`; PayPal
credentials remain on the server and are never sent to the browser.

From the repository root:

```powershell
npm run ui
```

Or from `PayPalAI`:

```powershell
npm run ui
```

Open the printed `http://127.0.0.1:3000` URL. Run a full case in this order:

1. Create a case with its request and stack/constraints.
2. Generate, revise if needed, and approve criteria.
3. Enter amount/currency and create the PayPal Sandbox buyer order.
4. **Manual:** open the approval link and approve it with the configured sandbox buyer.
5. Check status to record the authorization and expiration.
6. Upload a submission folder or zip (maximum 50 MB).
7. Run verification.
8. If escalated, inspect the human-review panel and choose release or reject.
9. After release, refresh payout status and inspect capture, batch, and item results.
