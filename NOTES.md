# Delivery verifier notes

- The sandbox detects Docker and prefers `--network none` with a read-only mount. Without Docker (the local fallback), it uses a temporary directory, `PATH`/`NODE_ENV` only, `npm install --ignore-scripts`, a 120-second timeout, and no explicit network firewall; this is weaker isolation.
- The model names and API key are never hardcoded. The existing nested project config and prompt are resolved at runtime because this repository stores them under `PayPalAI/trustmilestone/backend/`.
- Test criteria are associated with test assertions by their `// REQ-n` comments. Generated criterion IDs are mapped to `REQ-n` by the verifier for the supplied case fixtures.
- A code-review criterion is decided only when all three model verdicts agree; two-of-three agreement is intentionally `unclear` per the specification.
- The milestone implementation is a file-backed mock only; no PayPal integration was added.
- Unit and integration tests are included in `tests/`. `npm test` passed: 4 suites and 11 tests. `npm run build` passed.
- The c01 V2 manifest says its negative-quantity test fails after changing `< 0` to `<= 0`, but the supplied test only sends `-1`, so it passes both implementations. The integration test therefore includes a mocked code-review criterion for the stated boundary behavior; no protected fixture was changed.
