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
