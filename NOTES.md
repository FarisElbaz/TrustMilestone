# Delivery verifier notes

- The sandbox detects Docker and prefers `--network none` with a read-only mount. Without Docker, the fallback uses a temporary directory, `PATH`/`NODE_ENV` only, `npm install --ignore-scripts`, a 120-second timeout, and no explicit network firewall.
- Model names and API keys are resolved at runtime and are never hardcoded. Secrets are never recorded here.
- Test criteria are associated with test assertions by their `// REQ-n` comments. Code-review criteria require agreement from all three judge models; otherwise the result is `unclear`.
- The c01 V2 manifest describes a zero-quantity boundary, while its supplied test sends `-1`; the integration test includes a mocked code-review criterion for the stated boundary behavior. Protected fixtures were not changed.

## Checkpoint observations

- Checkpoint 1 (2026-11-03): configuration validation aggregates missing credentials, exact sandbox environment, sandbox API base, amount, and currency failures without printing secrets. The mocked test suite covers each invalid configuration class. No PayPal ID or live status was observed.
- Checkpoint 2 (2026-11-03): the OAuth client sends `Authorization: Bearer <token>`. Order approval is followed by `POST /v2/checkout/orders/{id}/authorize` exactly once; the authorization ID and `expiration_time` are persisted. The local mocked suite confirms request IDs on POST calls. No authorization ID was observed in live testing because buyer approval was not completed.
- Checkpoint 3 (2026-11-03): capture, void, expiry, duplicate milestone, currency, cumulative amount, and recorded-authorization guards are enforced. Each successful PayPal operation records its returned status in `paypalResponses`; unknown statuses mark the case `needsReview`. No live capture or void status was observed.
- Checkpoint 4 (2026-11-03): milestone records retain number, amount, capture ID, invoice ID, payout batch ID/status, item statuses, operation status, and timestamp. Multiple milestone numbers remain supported, while cumulative value cannot exceed the funded amount. No live milestone ID or status was observed.
- Checkpoint 5 (2026-11-03): payouts use deterministic `sender_batch_id` values and `recipient_type: EMAIL`. Submitted batches are polled until `SUCCESS`, `DENIED`, or `CANCELED`; item statuses are retained. No live payout batch ID, item status, or balance change was observed.
- Checkpoint 6 (2026-11-03): escalation resolution performs no PayPal call when recorded; release uses the guarded capture/payout path and reject uses void only before capture. Authorization expiration is checked before resolution. No live reviewer-resolution ID or status was observed.
- Checkpoint 7 (2026-11-03): live sandbox execution reached order creation. PayPal order ID `83609896K7864740D` returned status `CREATED`; the observed response shape included `id`, `status`, and `links[]` containing the approval link. The persisted record is `out/live-remainder-1793732114723/paypal.json`. The runner printed the approval URL for `buyerjohndoe@personal.example.com`, but this non-interactive session could not approve it and ended with the exact error `readline was closed`. No authorization, capture, payout, void, balance, or remainder result was observed. The created order remains an unapproved sandbox test artifact.
- Unit/integration validation (2026-11-03): `npm run build` passed; `npm test -- --runInBand` passed with 7 suites and 28 tests.
- Checkpoint 8 (2026-11-03): README documents PowerShell/bash setup and the command order `fund`, buyer approval, `payment:status`, `verify`, and `review`. This notes file records the observed live order and explicitly separates verified behavior from unverified live results.

## Limitations

- Live checkpoints requiring buyer approval cannot complete in a non-interactive runner; the observed live run stopped after one `CREATED` order.
- No live remainder, expiration-window, void, payout, contractor-balance, or full verifier result is claimed.
- Payout retry recovery is conservative: an existing recorded batch is queried rather than resubmitted; no automatic background retry job is implemented.
- State is file-backed under `out/`; there is no database, webhook listener, account provisioning, or automatic balance API.
- PayPal response bodies are not copied wholesale into NOTES.md. IDs and non-secret status/shape observations are recorded, while operation statuses are persisted in `paypal.json`.

## Web interface dependencies

- `busboy`: parses browser multipart uploads without buffering the HTTP request in a framework.
- `adm-zip`: extracts uploaded zip submissions after path-traversal and 50 MB checks.
- `@types/busboy` and `@types/adm-zip`: TypeScript declarations for those two runtime dependencies.

## Demo walkthrough

1. From the repository root, run `npm run ui`; the server binds only to `127.0.0.1` and requires `PAYPAL_ENV=sandbox`.
2. Create a case from the home page with a case ID, client request, and stack/constraints.
3. Generate criteria, review the checklist and open questions, revise if needed, then approve it.
4. Enter the amount and currency and create the buyer order.
5. **Manual buyer action:** open the PayPal Sandbox approval link and approve it with `PAYPAL_BUYER_EMAIL`.
6. Click Check status and confirm the authorization ID and expiration time.
7. Upload the worker submission as a folder or zip. The upload is stored under `out/<case-id>/submission/`.
8. Run verification and inspect each criterion, evidence, and routing decision.
9. If the result is `escalate`, inspect the review summary and choose release or reject.
10. After release, refresh payout status and inspect the capture ID, payout batch ID, payout status, and item statuses.

## UI validation (2026-11-04)

- Added mocked HTTP route coverage for case creation, duplicate IDs, criteria/funding gating, path traversal rejection, missing submission verification, and expired review resolution.
- `npm run build` passed.
- `npm test -- --runInBand` passed: 10 suites, 43 tests.

## Manual steps

1. Run `npm run criteria -- --case <case-id>`.
2. Read each generated criterion and open question. Type `approve`, or type `revise` and provide a free-text note. Repeat until the criteria are correct; type `cancel` to stop.
3. Set `OPERATOR_NAME` before approval if an operator name should be recorded.
4. Run `npm run fund -- --case <id> --amount <value> --currency <code>` to create the sandbox authorization.
5. Open the printed PayPal approval link and approve it with `PAYPAL_BUYER_EMAIL`.
6. Run `npm run payment:status -- --case <id>` to record the PayPal authorization and its expiry.
7. Run `npm run verify -- --case testset/cases/<id> --submission <submission-path>`.
8. If verification escalates, read `out/<id>/review.md`, then run `npm run review -- --case <id>` to display the handoff and expiry warning.
9. Resolve a pending handoff with `npm run review -- --case <id> --decision release` or `--decision reject`. A resolved or expired review cannot be resolved again.

## Feature validation (2026-11-04)

- Added criteria proposal/approval state under `out/<case-id>/criteria.json`; regeneration resets status to `proposed` and removes approval metadata.
- Verification now consumes only approved criteria and writes `review.json` plus `review.md` when routing escalates. The existing local hold behavior remains unchanged.
- Added review resolution guards for pending status, expiry, double resolution, and reject-after-capture without a PayPal call.
- `npm run build` passed.
- `npm test -- --runInBand` passed: 9 suites, 38 tests.
