# Notes

- Each case uses an in-memory Express app so it is self-contained and deterministic; IDs and dates are supplied or fixed in the app rather than relying on external services.
- Every package includes only Express at runtime and the TypeScript/Jest/supertest tooling required by the requested stack.
- Ambiguity decisions: c02 leaves discount stacking unspecified and V4 treats multiple codes as stackable; c05 leaves zero stock unspecified and V4 permits the reference behavior (zero is accepted); c06 leaves business-days versus calendar-days unspecified and V4 is represented as the calendar-day interpretation used by the reference. Tests intentionally avoid all three points.
- V4 for cases without an ambiguity adds one unrequested endpoint and is expected to pass the stated tests.
- The test generator will be followed by a full npm install/test matrix; this file will be amended if verification needs a targeted fix.

- Verification fix: the initial run showed Jest parsed TypeScript as plain JavaScript; added the required ts-jest preset configuration to every runnable folder.
- Verification fix: c03, c05, and c06 V2 mutations initially passed because their altered edges were not exercised; changed them to affect the existing status, integer-validation, and exact-30-day tests, respectively.
- Prompt alignment: added the explicit `stack` field to every case manifest so criteria generation receives the requested Node 20, Express, TypeScript, Jest, and supertest stack instead of relying on the fallback.
