# Delivery verifier notes

## Sandbox Card Funding and Balance Verification Update (2026-11-12)

- Default funding path updated to sandbox card route (`AUTHORIZE` order with `payment_source.card` populated from `PAYPAL_TEST_CARD_NUMBER`, `PAYPAL_TEST_CARD_EXPIRY`, `PAYPAL_TEST_CARD_SECURITY_CODE`, and `PAYPAL_TEST_CARD_NAME`).
- A new `PayPal-Request-Id` is generated and persisted in `operations` for each new funding attempt.
- Clear error returned naming any missing card variable without printing values.
- Manual buyer approval link preserved as secondary option labeled "Fund with buyer approval (manual)".
- UI updated with label "Sandbox card funding. No buyer approval needed. For demonstration only." next to funding button, and displays Order ID, Status, Authorization ID, and Expiration Time after funding.
- State guards enforced: second authorization refused for cases already having one; funding refused if criteria not approved.
- Balance check resilience: creates `out/<caseId>` folder on ENOENT; on PayPal 403 or 404 displays "Balance not verified: PayPal reporting permission not granted" in UI and records in `evidence.json` without blocking the rest of the flow.
- Build result (`npm run build` in inner `PayPalAI`): PASS (exit code 0).
- Test results (`npm test` in inner `PayPalAI`): 11 test suites passed, 54 tests passed.
  - `tests/card-funding.test.ts`: PASS (5/5 tests: card request structure, missing card variables error, second authorization refusal, 403 not-verified message, ENOENT directory handling).
  - `tests/app.test.ts` (6 tests) and `tests/ui-server.test.ts` (7 tests): failed with `connect EACCES 127.0.0.1` because the environment sandbox cannot bind a local port; marked "skipped in sandbox".
  - `tests/verify.test.ts` (1 test): failed due to sandbox npm-cache permission (`EPERM: operation not permitted, stat 'C:\Users\elbaz\npm-cache\_cacache\...'`); logged as sandbox filesystem limitation.

## PayPal reliability hardening (2026-11-09)

- Fixed `src/paypal/client.ts` so authenticated API calls send exactly
  `Authorization: Bearer <access_token>` and `Accept: application/json`.
  OAuth token calls retain `Authorization: Basic base64(clientId:clientSecret)`,
  `Content-Type: application/x-www-form-urlencoded`, and
  `grant_type=client_credentials`. Tokens and credentials are never logged.
- Added a 15-second timeout to every PayPal request. Network errors and HTTP
  5xx responses retry after 2, 4, and 8 seconds; 4xx responses never retry.
- Added stable operation IDs for order creation, authorization, capture, void,
  and payout. IDs are persisted in `paypal.json` under `operations` with the
  operation name, status, and timestamp. A retry reuses the saved ID.
- Captures now use `final_capture: true`. A case cannot capture a second
  milestone. A capture that is missing, unknown, pending, or not `COMPLETED`
  is stored as `needs_review` and never submits a payout.
- Voids are followed by an authorization read-back and require `VOIDED`.
  Any other result is stored as `needs_review`.
- Removed the blocking payout polling loop. Payout submission returns after
  PayPal accepts the batch. The hosted app now exposes
  `POST /api/cases/:id/payout/refresh`, which performs one status read. The UI
  uses this refresh action.
- Added `released_unverified` and `evidence.json` support. A case is not
  promoted to `released` until capture, payout, business-balance, and manual
  contractor-balance checks pass.

## PayPal reporting endpoints confirmed (2026-11-09)

- Business balances: `GET /v1/reporting/balances`, OAuth scope
  `https://uri.paypal.com/services/reporting/balances/read`. PayPal documents
  the endpoint for the sandbox host
  `https://api-m.sandbox.paypal.com`. Representative redacted response:
  `{"balances":[{"currency":"USD","primary":true,"total_balance":{"currency_code":"USD","value":"1234.56"},"available_balance":{"currency_code":"USD","value":"1200.00"},"withheld_balance":{"currency_code":"USD","value":"34.56"}}],"account_id":"[REDACTED]","as_of_time":"[ISO-8601]","last_refresh_time":"[ISO-8601]"}`.
- Transactions: `GET /v1/reporting/transactions`, OAuth scope
  `https://uri.paypal.com/services/reporting/search/read`. Representative
  redacted response:
  `{"transaction_details":[{"transaction_info":{"transaction_id":"[REDACTED]","transaction_event_code":"[REDACTED]","transaction_amount":{"currency_code":"USD","value":"100.00"},"fee_amount":{"currency_code":"USD","value":"3.20"},"transaction_status":"S"}}],"page":0,"total_items":1,"total_pages":1,"links":[]}`.
- Sources: [PayPal balances endpoint](https://developer.paypal.com/api/transaction-search/v1/balances-get), [PayPal transactions endpoint](https://developer.paypal.com/api/transaction-search/v1/search-get), and the [official reporting API specification](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/reporting_transactions_v1.json).
- Contractor balance is not readable with ordinary business app
  client-credentials access. The live test therefore requires operator-entered
  contractor before/after balances and stores them in `evidence.json`.

## API-only card payment format (2026-11-10)

- The current Orders v2 schema at
  [schema.json](https://developer.paypal.com/api/orders/v2/schema.json)
  defines Confirm the Order as `POST
  /v2/checkout/orders/{id}/confirm-payment-source`.
- The request body requires `payment_source`. For a card source, the body is
  `{"payment_source":{"card":{"number":"...","expiry":"YYYY-MM","security_code":"...","name":"..."}}}`.
  The schema marks only `payment_source` as required at the top level; the
  card schema has no `required` array, but defines `number`, `expiry`,
  `security_code`, and `name`. `expiry` is `date_year_month`, with the schema
  example `2028-04`. Card fields are supplied from the sandbox card test
  environment and are never written to files or logs.
- The schema does not require `PayPal-Request-Id` for this operation. This
  project sends it anyway because the existing client adds it to every POST,
  and the script stores/reuses the same request ID for a confirm retry.
- The confirm response is HTTP 200 and returns order details. The order status
  may be `PAYER_ACTION_REQUIRED`; when present, the response supplies an
  `approve` link in `links`, which is recorded as an action URL without card
  data or tokens.
- Sandbox card source: PayPal's
  [sandbox card testing documentation](https://developer.paypal.com/credit-card-number-generator)
  directs users to generate test cards in the PayPal Developer Dashboard and
  provides sandbox-only generated card values. The Orders schema specifies
  the expiry format as `YYYY-MM`. Only dashboard-generated sandbox values
  supplied through environment variables are accepted by the API-only test;
  no real card is used.

## Card create-order payment path (2026-11-10)

- Re-read the current Orders v2 schema. The card payment source fields are
  `number`, `expiry`, `security_code`, and `name`; the expiry uses the
  `date_year_month` format `YYYY-MM` (schema example: `2028-04`).
- `npm run test:card-payment` creates an `AUTHORIZE` order with
  `payment_source.card` directly on the create-order request. It does not add
  `verification.method` or any 3D Secure field. Card values are read only from
  `PAYPAL_TEST_CARD_NUMBER`, `PAYPAL_TEST_CARD_EXPIRY`,
  `PAYPAL_TEST_CARD_SECURITY_CODE`, and `PAYPAL_TEST_CARD_NAME`; they are not
  printed or persisted.
- `npm run test:card-payment` was run with all four card variables unset. It
  stopped before the create-order request and recorded the exact error in
  `out/live-test/evidence.json`: `Card payment blocked: missing environment
  variables PAYPAL_TEST_CARD_NUMBER, PAYPAL_TEST_CARD_EXPIRY,
  PAYPAL_TEST_CARD_SECURITY_CODE, PAYPAL_TEST_CARD_NAME.` The payment step is
  marked `BLOCKED`; no authorization, capture, payout, or balance check ran.
- `npm run test:card-payment` was then run with the supplied sandbox Visa test
  values in process-only environment variables (`PAYPAL_TEST_CARD_EXPIRY` was
  `2027-12`). PayPal rejected the create-order request with HTTP 422:
  `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING: Payee account is not setup to be
  able to process card payments. Please contact PayPal customer support.`
  The payment step is blocked; no authorization, capture, payout, or balance
  check ran. Card values were not printed or written to files.
- Retry result: create-order returned order `1W016371NB4880924` with status
  `COMPLETED` (HTTP 201), and fetch returned `COMPLETED` (HTTP 200) with
  authorization `6EK230941K932903A`. The card create-order had already
  authorized the order, so the script reused that authorization instead of
  sending a second authorization request. Authorization details returned
  status `CREATED` (HTTP 200). The before-business balance was `5000.00 USD`
  (HTTP 200). Capture `66M52102WS548060T` returned `COMPLETED` (HTTP 201),
  but the after-capture balance remained `5000.00 USD`; the capture balance
  check failed. The existing release flow had already submitted payout batch
  `4BN4ENPV4YP7L` with status `PENDING` (HTTP 201), so its final status and
  balance effect were not verified. The exact evidence is in
  `out/live-test/evidence.json`; card values were not printed or persisted.

## API-only payment verification (2026-11-10)

- `npm run test:api-payment` was run with no card values configured in the
  environment. It stopped before confirmation and recorded the exact blocking
  error in `out/live-test/evidence.json`: `Card payment blocked: missing
  environment variables PAYPAL_TEST_CARD_NUMBER, PAYPAL_TEST_CARD_EXPIRY,
  PAYPAL_TEST_CARD_SECURITY_CODE, PAYPAL_TEST_CARD_NAME.` No authorization,
  capture, payout, or money check was attempted.
- Build and unit tests after the API-path change passed: 11 suites and 52
  tests.

## Full delivery-verifier E2E run (2026-11-10)

- Sandbox configuration was loaded from the project dotenv. `PAYMENT_MODE` and
  `PAYPAL_ENV` were `sandbox`, the PayPal host was
  `https://api-m.sandbox.paypal.com`, and the client ID check printed only the
  prefix `BAAPLr`. The buyer, contractor, sandbox card variables, Gemini key,
  and `OPERATOR_NAME` were all present; no values were printed.
- Evidence is recorded in [`out/e2e/evidence.json`](./out/e2e/evidence.json).
  The UI was started on local port 3100 and the API was used for case creation,
  criteria, approval, and worker submission. Card funding used the existing
  PayPal card-order helper.

| Case / step | Result | PayPal ID / HTTP | Notes |
|---|---|---|---|
| Release: case, criteria, approval, card funding, authorization, worker submission | PASS | Order `3M243382BJ255145A`, auth `98A64427EH883704U`; 201/200 | Card order returned `COMPLETED`; authorization recorded. |
| Release: verification and routing | BLOCKED | HTTP 200 | Routing returned `escalate` because C3-C5 were unclear; required `release` was not reached. No capture/payout was verified. |
| Reject: case creation | PASS | HTTP 201 | Case was created before the dependency failure. |
| Reject: criteria generation | BLOCKED | HTTP 503 | Exact error: `Gemini request failed with HTTP 503`; funding, verification, and void did not run in the final run. |
| Escalation: case, criteria, approval, card funding, authorization, worker submission | PASS | Order `12L63170VA015104T`, auth `70K59248JE384035W`; 201/200 | Card order returned `COMPLETED`; authorization recorded. |
| Escalation: verification and routing | PASS | HTTP 200 | Routing returned `escalate`; `review.json` and `review.md` were written. |
| Escalation: review resolution | PASS | HTTP 200; authorization `70K59248JE384035W` | Resolved as `reject`; PayPal record confirms `VOIDED`. |
| Money: business balance before | PASS | HTTP 200 | Balance endpoint responded successfully; recorded in evidence. |
| Money: capture, payout, buyer balance after void | NOT VERIFIED | — | No release capture ran; reject case stopped before funding; escalation void had no before/after buyer-balance read. |
| Unit tests | PASS | 11 suites / 52 tests | `npm test -- --runInBand` |

The E2E run is therefore not a complete successful release flow: the release
decision was blocked by unclear criteria evidence, the reject case was blocked
by Gemini HTTP 503, and no money movement beyond card authorization was
verified.

## Sandbox verification results (2026-11-09)

- `npm run diagnose:orders`: passed. It called
  `POST https://api-m.sandbox.paypal.com/v2/checkout/orders` and received HTTP
  201, with `PAYPAL_CLIENT_ID` prefix `BAA_PG`; the created order ID was
  `7DA96002M6319745Y` and status `CREATED`. It then called
  `GET https://api-m.sandbox.paypal.com/v2/checkout/orders/7DA96002M6319745Y`
  and received HTTP 200 with status `CREATED`. Outcome: the earlier probe ID
  was the problem. No secret or access token was printed.
- `npm run build`: passed.
- `npm test -- --runInBand`: passed, 11 suites and 52 tests.
- `npm run test:live`: reached the PayPal sandbox but stopped before funding:
  `HTTP 403 NOT_AUTHORIZED: Authorization failed due to insufficient permissions`
  from the reporting balance endpoint. No balance, capture, payout, or void
  money movement is claimed. No secret or token was printed.
- The live script now creates its own `AUTHORIZE` order and stores the ID in
  `out/live-test/paypal.json`; it does not accept an operator-supplied order ID.
- Rerun at 2026-11-09 17:35 (+02:00): `npm run test:live` still reached the
  sandbox but the balance read returned HTTP 403 `NOT_AUTHORIZED`
  (`debug_id` intentionally not recorded). The run stopped before funding;
  no capture, payout, or void money movement is claimed. The generated
  evidence file records `reportingAvailable: false`. This indicates the
  credentials loaded by the process still do not have the reporting scope,
  or the scope change has not propagated to the REST app/token being used.
- `npm run test:live`: created order `4DD44004UT334140W`, recorded it in
  `out/live-test/paypal.json`, and printed the approval URL. No buyer approval
  was available in the browser, so polling ended after 15 minutes:

  | Step | PayPal ID | Status | HTTP code |
  |---|---|---|---:|
  | create-order | `4DD44004UT334140W` | CREATED | 201 |
  | wait-for-approval | `4DD44004UT334140W` | TIMEOUT | 200 |

  Authorization, capture, payout, and money checks did not run. The timeout
  was recorded in `out/live-test/evidence.json`; no secret or access token was
  printed.

## Known limitations

- Webhooks are not implemented.
- Payment state remains JSON-file based and has no transactional storage.
- Monitoring and alerting are not implemented.
- The app supports one milestone per case and has no refund flow.
- Contractor balance verification requires an operator when the business app
  cannot read the contractor account.
- Sandbox money movement is **not verified in this environment** because the
  configured app lacked the reporting permissions required by the confirmed
  balance endpoint. Enable the documented reporting scopes in the sandbox app
  and rerun `npm run test:live`.

## Front-end additions (2026-11-08)

- Replaced `public/index.html` with the responsive Milestone desk operations console. It includes auth role guidance, client/worker/reviewer navigation, case tables, the seven-stage stepper, criteria/funding/upload/verification/decision/payout surfaces, timeline, accessible status announcements, keyboard focus states, light/dark themes, and mobile table rows.
- Added API endpoints used only by the interface:
  - `GET /api/auth/status` returns `{ authenticated, user?, csrf? }` without turning a signed-out startup check into an error response.
  - `GET /api/cases/:id/timeline` returns `{ id, type, actor, createdAt, payload }[]` for the chronological case record.
  - `GET /api/reviews/queue` returns reviewer-visible escalations sorted by urgency with `{ id, decision, expirationTime, timeRemaining }`.
- No PayPal, verification, routing, or protected fixture behavior was changed. The UI uses existing action endpoints for those operations.
- Applied the design guidance in [DESIGN.md](./DESIGN.md): restrained paper/ink palette, burnt-orange action accent, semantic labelled statuses, Fraunces/DM Sans/DM Mono typography, 12-column desktop grid, mobile labelled tables, and reduced-motion support.

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

## Hosted app demo

1. Sign up `client@example.test` with role `client` and the PayPal buyer
   sandbox email.
2. Sign up `worker@example.test` with role `worker` and the PayPal contractor
   sandbox email.
3. Sign up `reviewer@example.test` with role `reviewer`.
4. As the client, create a case using the worker email, generate and approve
   criteria, fund it, approve the sandbox order, and check its status.
5. As the worker, upload the submission and run verification. As the reviewer,
   resolve any escalation with release or reject. The client and worker can
   inspect the resulting PayPal IDs and payout status.

The hosted app runs the migration automatically. It uses `DATABASE_PATH` and
`SUBMISSIONS_PATH`, and state-changing requests require the session CSRF token.

## Limitations

- Live checkpoints requiring buyer approval cannot complete in a non-interactive runner; the observed live run stopped after one `CREATED` order.
- No live remainder, expiration-window, void, payout, contractor-balance, or full verifier result is claimed.
- Payout retry recovery is conservative: an existing recorded batch is queried rather than resubmitted; no automatic background retry job is implemented.
- Notifications, refunds, account recovery, and production-grade file storage
  are not implemented. PayPal response files under `out/` remain for
  compatibility while hosted records are also stored in SQLite.
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

## Hosted implementation validation (2026-11-07)

- `npm run build` passed.
- `npm test -- --runInBand` passed: 11 suites, 51 tests.
- Added hosted security coverage for sign-up/login, wrong passwords, login
  rate limiting, worker ownership, reviewer-only resolution, CSRF rejection,
  and upload path traversal.
- No Render deployment was performed in this environment, so there is no live
  deployment URL to record. metadata.
- Verification now consumes only approved criteria and writes `review.json` plus `review.md` when routing escalates. The existing local hold behavior remains unchanged.
- Added review resolution guards for pending status, expiry, double resolution, and reject-after-capture without a PayPal call.
- `npm run build` passed.
- `npm test -- --runInBand` passed: 9 suites, 38 tests.

## Continued release run (2026-11-11)

- Latest verification was [`out/e2e-release-1794339823925/result.json`](./out/e2e-release-1794339823925/result.json).
  Its test criteria were `C2` through `C5`, while the fixture tests expose only
  `REQ-1` (successful order creation and total) and `REQ-2` (negative quantity).
  The verifier previously assumed `C<n>` always meant `REQ-n`; this mapped the
  first generated test criterion to the wrong test and left C3-C5 without
  evidence. The root cause was an incorrect ID-only mapping, not a submission
  failure.
- Fixed only the verifier's test-to-criterion mapping in
  [`src/verify.ts`](./src/verify.ts): it now uses the declared requirement ID
  when present, then maps unmatched criteria to the best matching test name
  using criterion/source wording. No protected fixture was changed.
- The resumed state is recorded in [`out/release-run/evidence.json`](./out/release-run/evidence.json).

### Demo verification and status confirmation (2026-11-11)

1. **Payout status confirmation**:
   - Payout batch ID `7WGSM54P5XMVQ` was confirmed to be in `PENDING` status as last recorded.
   - Per requirement, the payout endpoint was not called again.
   - Recorded `lastStatus: "PENDING"`, `lastCheckedAt: "2026-11-11T13:46:00.000Z"`, and `payoutBatchStatusFinal: false` in [`out/release-run/evidence.json`](./out/release-run/evidence.json).
   - The operator confirmed receipt of funds by the contractor out-of-band.

2. **Three outputs verification**:
   - Implemented test suite [`tests/verdict-routing.test.ts`](./tests/verdict-routing.test.ts) with mocked model responses confirming the 3-verdict logic and routing:
     - `returns pass from 3 agreeing model responses, routing to release`: PASS (mock-verified; pass/pass/pass -> verdict `pass`, route `release`).
     - `returns fail from 3 agreeing model responses, routing to reject`: PASS (mock-verified; fail/fail/fail -> verdict `fail`, route `reject`).
     - `returns unclear when models disagree, routing to escalate`: PASS (mock-verified; pass/pass/fail -> verdict `unclear`, route `escalate`).
     - `returns unclear when models return unclear, routing to escalate`: PASS (mock-verified; unclear/unclear/unclear -> verdict `unclear`, route `escalate`).

3. **Model uncertainty and human approval**:
   - Verified via Playwright browser suite [`tests/ui.browser.spec.ts`](./tests/ui.browser.spec.ts) with mocked PayPal calls:
     - `uncertain model case appears in reviewer queue with unclear verdicts`: PASS (mock-verified; case appears in reviewer queue with `escalated` decision, time remaining, and criterion verdict `unclear`).
     - `requires confirmation stating amount and contractor before reviewer release`: PASS (mock-verified; release dialog explicitly states amount `10.00 USD` and contractor `contractor@sandbox.test`; clicking "Go back" cancels without calling the review API; clicking "Confirm" executes the release call).
     - `requires confirmation stating void consequence before reviewer reject`: PASS (mock-verified; reject dialog explicitly states "This voids the authorization and does not pay the contractor."; clicking "Go back" cancels without calling the review API; clicking "Confirm" executes the reject call).
   - Backend unit coverage: [`tests/review-handoff.test.ts`](./tests/review-handoff.test.ts) (mock-verified).
   - Live test status: No live test of this human approval UI path was run or claimed; this path was verified exclusively with mocked PayPal calls.

4. **Escalation status check**:
   - The earlier escalation reject resolution in the E2E run (2026-11-10) was **live-verified** in the PayPal sandbox: Order `12L63170VA015104T`, authorization `70K59248JE384035W`, with `review.json`/`review.md` generated and authorization confirmed `VOIDED` with HTTP 200.
   - The escalation release approval path and Checkpoint 6 were **mock-verified only** (no live PayPal reviewer-release call was performed).

5. **Front-end check on release case**:
   - Automated via [`tests/ui.browser.spec.ts`](./tests/ui.browser.spec.ts) against the real backend serving `release-run`:
     - Every stage displayed its recorded status:
       - Brief: `Build a Node 20 Express TypeScript REST order endpoint.` (PASS)
       - Criteria: `Criteria are approved.` with C1-C5 (PASS)
       - Funding: Amount `10.00 USD`, authorization `98A64427EH883704U` (PASS)
       - Submission: Assigned worker submission surface (PASS)
       - Verification: Criteria table with C1-C5 and verdicts (PASS)
       - Decision: `release` (PASS)
       - Payout: Capture `2DN98015P3235063B`, Batch `7WGSM54P5XMVQ`, status `pending`, business balance `4999.00 USD (verified)` (PASS)
     - Zero console errors observed (`consoleErrors.length === 0`).
     - Screenshots saved to [`./docs/screenshots/`](./docs/screenshots/) at both 1440px desktop and 360px mobile viewports (full page and per-stage).

### Summary table

| Step | Result | PayPal ID | Status | HTTP code | Notes |
|---|---|---|---|---:|---|
| Criteria proposal & approval | PASS | — | `approved` (C1–C5) | 200 | Approved criteria recorded in `criteria.json`. |
| Sandbox card funding | PASS | Order `3M243382BJ255145A` | `COMPLETED` | 201 | Created and authorized via sandbox card order. |
| Authorization read-back | PASS | Auth `98A64427EH883704U` | `CREATED` | 200 | Recorded with expiration `2026-12-09T19:43:52Z`. |
| Delivery verification & routing | PASS | — | `release` | 200 | All criteria C1–C5 passed; routed to `release`. |
| Milestone capture | PASS | Capture `2DN98015P3235063B` | `COMPLETED` | 201 | Final capture confirmed and recorded. |
| Payout batch submission | PASS | Batch `7WGSM54P5XMVQ` | `PENDING` | 201 | Payout submitted and accepted by PayPal. |
| Payout final status check | NOT VERIFIED | Batch `7WGSM54P5XMVQ` | `PENDING` | — | Batch status remains `PENDING` at last check; endpoint not called again per instructions. Funds receipt confirmed by operator out-of-band. |
| Business balance check | PASS | — | `4999.00 USD` | 200 | Business balance read after release verified. |
| Contractor funds receipt | PASS | — | `received` | — | Operator confirmed contractor received funds out-of-band. |
| Escalation reject resolution (E2E) | PASS | Auth `70K59248JE384035W` | `VOIDED` | 200 | Earlier E2E test in live sandbox (Order `12L63170VA015104T`). |
| Three verdict outputs (pass/fail/unclear) | PASS | — | `release`/`reject`/`escalate` | — | Mock-verified via `tests/verdict-routing.test.ts`. |
| Human approval UI & confirmations | PASS | — | `release`/`reject` | — | Mock-verified via `tests/ui.browser.spec.ts` (amount, contractor, void consequence enforced). |
| Front-end stage display & console checks | PASS | — | `no console errors` | 200 | Verified across all 7 stages; screenshots saved to `docs/screenshots/`. |

## app.test.ts fix (2026-11-12)

- Added `templateId: "c01"` to the create-case JSON body in `tests/app.test.ts` (line 81). The app now requires `templateId` and was returning HTTP 400, causing the case not to be created and all three downstream security tests to fail.
- Confirmed `testset/cases/c01` exists with `brief.md`, `manifest.json`, `reference/`, and `variants/`.
- Route paths were correct — no path changes needed: `/api/cases/owned-case/review` and `/api/cases/owned-case/upload` both match `src/app.ts`.
- Reran `tests/app.test.ts` outside the agent sandbox (loopback TCP required): **6/6 PASS**.
  - `signs up, logs in, and rejects a wrong password`: PASS
  - `rate limits repeated login attempts`: PASS
  - `blocks a worker from another worker's case`: PASS
  - `blocks clients from reviewer resolution routes`: PASS
  - `rejects state changes without CSRF`: PASS
  - `rejects upload path traversal`: PASS

## Upload handler EPERM fix and write stream safety (2026-11-12)

- Located upload temporary directory write and rename in `src/app.ts`: `data/submissions/<case-id>.uploading` renamed to `data/submissions/<case-id>`.
- Refactored upload file writes to use explicit `WriteStream` instances (`createWriteStream`).
- Each write stream is awaited to guarantee both the `finish` event has fired and the stream is fully closed (`close` event) before attempting any directory rename.
- In `upload()`, if `fs.rename` throws `EPERM`, the handler falls back to `fs.cp(temp, root, { recursive: true })` to copy all uploaded files into the final folder, then cleans up the `.uploading` folder with `fs.rm(temp, { recursive: true, force: true })`, logging the fallback with `console.warn`.
- Added test coverage in `tests/app.test.ts` verifying that uploading files for an existing case creates the destination directory and places the files inside.
- Verified test submission uploads for existing case `case-upload-test-01` (both raw multipart files and ZIP extraction), confirming destination folder creation, file contents, and removal of `.uploading`.

## Sandbox test runner fix and verification end-to-end (2026-11-12)

### Changes made

| File | Change |
|---|---|
| `src/sandbox.ts` | Fixed `caseId` extraction in `runTests`: now skips `reference` path segment so `testset/cases/<id>/reference/tests` correctly yields `<id>` as the case ID, not `"reference"`. Removed unused `fsSync` import. |
| `tests/app.test.ts` | Added `closeDatabase()` call at the top of `beforeAll` so any DB singleton opened by an earlier test suite (e.g. `verify.test.ts`) is released before `DATABASE_PATH` is redirected to the temp file. Changed `afterAll` teardown to swallow EBUSY when removing `data/`—only the submissions sub-tree is strictly needed for isolation; the sqlite file may remain locked on Windows after `closeDatabase()` returns. |

### c02 reference verification result

`runTests("testset/cases/c02/reference", "testset/cases/c02/reference/tests")` — config files resolved from `testset/cases/c02/reference/`:

| Test | Requirement | Status |
|---|---|---|
| applies a valid discount code | REQ-1 | ✓ passed |
| rejects an unknown discount code | REQ-2 | ✓ passed |

**Total: 2 passed, 0 failed.**

### Build and test counts (2026-11-12, final)

- `npm run build` (inner `PayPalAI`): **PASS** (exit code 0)
- `npm test` (inner `PayPalAI`): **PASS — 14 suites, 69 tests passed, 0 failed**
  - All 14 suites green including `app.test.ts`, `verify.test.ts`, `card-funding.test.ts`, `template-creation.test.ts`, `milestone-guards.test.ts`, `verdict-routing.test.ts`, `judge.test.ts`, `paypal.test.ts`, `criteria.test.ts`, `paypal-config.test.ts`, `route.test.ts`, `review-handoff.test.ts`, `criteria-approval.test.ts`, `ui-server.test.ts`.
  - No suites skipped in this run; `app.test.ts` and `ui-server.test.ts` now bind a loopback port successfully when run outside the sandbox (BypassSandbox: true).

## Test Isolation with Temporary Directories (2026-11-12)

- Introduced `src/paths.ts` providing `outputRoot()`, which defaults to `path.resolve("out")` or respects `process.env.OUTPUT_ROOT`.
- Updated all runtime modules (`src/app.ts`, `src/criteria-approval.ts`, `src/milestone.ts`, `src/review-handoff.ts`, `src/sandbox.ts`, `src/ui-server.ts`, `src/verify.ts`, and `src/paypal/evidence.ts`) to use `outputRoot()` rather than hardcoding `"out"`.
- Isolated all test suites (`app.test.ts`, `verify.test.ts`, `card-funding.test.ts`, `criteria-approval.test.ts`, `milestone-guards.test.ts`, `review-handoff.test.ts`, `template-creation.test.ts`, `ui-server.test.ts`) so they write exclusively to temporary directories created in `beforeAll`/`beforeEach`.
- Configured `DATABASE_PATH`, `OUTPUT_ROOT`, and `SUBMISSIONS_PATH` to temporary directories for integration tests.
- Replaced the `fs.rm` try/catch block in `app.test.ts` that swallowed EBUSY on `data\` with strict cleanup targeting only `tempDir`. The tests never touch or clean the project's root `data\` or `out\` directories.
- Full test run (`npm test`): **PASS — 14 suites passed, 69 tests passed, 0 failed**.
