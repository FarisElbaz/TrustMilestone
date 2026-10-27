# Test set summary

| Case | Feature | Requirements | Tests | Verification |
|---|---|---:|---:|---|
| c01 | POST /orders: create order from product + qty | 2 | 5 | Reference/V1 pass; V2/V3 fail as listed; V4 expected pass |
| c02 | POST /orders/discount: apply discount code | 2 | 5 | Reference/V1 pass; V2/V3 fail as listed; V4 expected unclear |
| c03 | POST /orders/:id/cancel with status rules | 3 | 7 | Reference/V1 pass; V2/V3 fail as listed; V4 expected pass |
| c04 | GET /products with filters and pagination | 2 | 5 | Reference/V1 pass; V2/V3 fail as listed; V4 expected pass |
| c05 | PATCH /products/:id/stock with validation | 3 | 7 | Reference/V1 pass; V2/V3 fail as listed; V4 expected unclear |
| c06 | POST /refunds with a 30-day window | 3 | 10 | Reference/V1 pass; V2/V3 fail as listed; V4 expected unclear |
| c07 | GET /orders/:id with role-based field hiding | 3 | 7 | Reference/V1 pass; V2/V3 fail as listed; V4 expected pass |
| c08 | POST /carts/items merging duplicate products | 3 | 7 | Reference/V1 pass; V2/V3 fail as listed; V4 expected pass |
