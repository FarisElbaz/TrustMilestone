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
npm run fund -- --case c01 --amount 10.00 --currency USD
npm run payment:status -- --case c01
npm run verify -- --case testset/cases/c01 --submission testset/cases/c01/reference
```

Approve the printed order URL as `PAYPAL_BUYER_EMAIL` before running
`payment:status`. The verifier then captures milestone 1 and sends the payout.
For an escalation, resolve it with:

```powershell
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
account password/email. The integration intentionally has no web UI, account
provisioning, database, webhook listener, automatic balance API, or background
retry job in this phase.
