# Postman / Newman Testing

How the production API testing system works: what each file is, how to run it, how the ADMIN-gated parts are provisioned, and how to regenerate the final collection after an API change.

## Files

| File | What it is |
|---|---|
| `postman/multi-vendor-ecommerce-api.postman_collection.json` | **Source of truth.** Every request, test script, and variable-chaining script is edited here, and only here. |
| `postman/Multi-Vendor-E-Commerce-API.production.postman_collection.json` | **Generated.** The same collection, with real, sanitized, captured response examples inserted. Never hand-edited — see [Regenerating](#regenerating-the-final-collection). **This is the file to import if you just want to use the API.** |
| `postman/multi-vendor-ecommerce-api.postman_environment.json` | Local development environment (`baseUrl` → `http://localhost:3000`). |
| `postman/Production.postman_environment.json` | Production environment (`baseUrl` → `https://e-commerce.api.taijul.dev`). No real secrets — every secret-typed value ships blank. |
| `postman/multi-vendor-ecommerce-api.postman_environment.production.example.json` | Generic template for a *different* future deployment (placeholder `baseUrl`), kept separate from the one above, which already points at the real, current production URL. |
| `postman/smoke-tests.postman_collection.json` | Small, fast, ADMIN-independent post-deployment check. See [Smoke tests](#smoke-tests). |
| `postman/scripts/build-final-collection.js` | The capture/sanitize/merge pipeline that produces the `.production.` collection. |

## Initial setup

```bash
npm install        # installs newman (devDependency) along with everything else
```

No other setup is required to run the smoke suite or the parts of the full suite that don't need an ADMIN account. For the ADMIN-gated parts, see [Admin test provisioning](#admin-test-provisioning) below.

## Running smoke tests

```bash
npm run test:smoke
```

Runs `postman/smoke-tests.postman_collection.json` against production: HTTPS reachability, `/api/health` (with a real database/Redis check, not a static 200), Swagger UI + OpenAPI JSON reachability, one public endpoint, a full register→login→authenticated-request cycle, and one 401 security check. ~9 requests, a few seconds, exits non-zero on any failure — safe to wire into CI/CD after every deployment.

## Running the full suite

```bash
npm run test:api          # against production (postman/Production.postman_environment.json)
npm run test:api:local    # against localhost (postman/multi-vendor-ecommerce-api.postman_environment.json)
```

Runs every folder of the full collection in order. Folders 00 (Admin Setup) and everything from `06 Categories` onward require the ADMIN prerequisite below — without it, those specific requests fail (by design, not a bug) while everything else still runs and reports normally. See `PRODUCTION_CHECKLIST.md` / the project's own final report for the exact current pass/fail breakdown.

## Admin test provisioning

**No self-service admin-provisioning endpoint exists in this API, by design.** Registering an account (`POST /api/auth/register`) assigns no `Role` at all (`src/auth/auth.service.ts`) — `Role`/`UserRole` are separate tables (`prisma/schema/identity-access.prisma`) with no seed data beyond the three `Role` rows themselves (`prisma/seed.ts` seeds `ADMIN`/`VENDOR`/`CUSTOMER` as rows, nothing else). The only way to make a user ADMIN is a direct, one-time database write:

```sql
INSERT INTO user_roles (user_id, role_id)
SELECT '<the test admin user's id>', id FROM roles WHERE name = 'ADMIN';
```

Once that row exists, `00 Admin Setup > Login as ADMIN` (in the full collection) logs in with `{{adminEmail}}`/`{{adminPassword}}` and captures `{{adminAccessToken}}`, which every ADMIN-only request elsewhere in the collection already references. This is a normal, intended, reversible administrative action (the same one a real platform operator performs to make their first admin) — not a security workaround, and it grants nothing beyond the `ADMIN` role on one specific test account.

**Set `adminEmail`/`adminPassword` in the environment as secret values before running `00 Admin Setup` or anything past `06 Categories`.** Never commit real values for these — both ship blank in every environment file in this repo.

This has already been done once, for a dedicated `qa-admin@...` test account, to build and verify the collection end-to-end (see `PRODUCTION_CHECKLIST.md`/the project's own final report for that account's id). Its password is not stored anywhere in this repo — reuse it by setting `adminEmail`/`adminPassword` locally (e.g. in a gitignored copy of `Production.postman_environment.json`, or via Postman's own environment UI), never by committing it.

### RBAC permission-demo routes (a separate, smaller prerequisite)

`03 RBAC / Authorization Demo`'s permission-based routes (`Requires products:read permission`, `Requires ADMIN role AND products:read permission`, `Requires products:read AND inventory:adjust permissions (all)`) additionally require `Permission`/`RolePermission` rows that `prisma/seed.ts` explicitly does not create (see the README's "Implemented vs. Deferred"). These three routes will return 403 even for an ADMIN until such fixtures exist. This is **expected and documented**, not a bug — the project's own seed script deliberately defers permission data, and this test suite does not fabricate production RBAC configuration on its own judgment to work around that. If you want these three routes exercised, seed the specific `Permission`/`RolePermission` rows their `@Permissions()` decorators name (`src/auth/auth.controller.ts`) the same way the ADMIN role above was granted, then re-run `npm run postman:build -- --folder "03 RBAC / Authorization Demo"`.

## How dynamic variables work

Every id/token the collection needs downstream is captured automatically by a `pm.environment.set(...)` call in the producing request's test script — nothing is ever hardcoded or manually copied. The two variables that specifically fix a real bug found during the audit:

- **`testRunEmail`** — `02 Auth > Register` generates a random email (`jane.doe+{{$randomInt}}@example.com`) and captures the *exact* value the server echoed back; `02 Auth > Login` uses `{{testRunEmail}}`, not a hardcoded address, so it always logs back into the account this same run just created.
- **`shopSlug` / `productSlug`** — captured the same way, so the public `GET .../slug/:slug` lookups always target the record this run actually created instead of a stale hardcoded example slug.

All test-fixture data (vendor business name, shop name/slug, category name/slug, product name/slug) is prefixed `QA Test ...` / `qa-test-...` specifically so it's unambiguously identifiable in the production database — see [Production data created by this suite](#production-data-created-by-this-suite).

## How examples are generated/refreshed

`postman/scripts/build-final-collection.js`:

1. Runs the **source** collection through Newman (programmatic API) against a real environment.
2. For each executed request: if it's in `06`–`17` (a normal business-flow folder) and its own `pm.test()` assertions all passed, captures the real response as a "Success" example. If it's in `00 Admin Setup` or `18 Security & Negative Tests` (folders whose entire point is a specific non-2xx outcome), captures the real response regardless of pass/fail, named by its actual status code (`403 Forbidden`, `404 Not Found`, ...).
3. Redacts `accessToken`/`refreshToken`/`adminAccessToken`/`token`/`passwordHash`/`tokenHash` fields (wherever they appear in a body) and the `Authorization` header to `<REDACTED>` — the field is still present so the example still documents its existence, just never with a real value.
4. Skips embedding a body for binary responses (the product-image stream) — documents the `Content-Type` instead.
5. Merges into the previous `.production.` collection: an item this run didn't execute (e.g. because you ran with `--folder`) keeps whatever example it already had — nothing is ever wiped by a partial run.
6. Writes `postman/Multi-Vendor-E-Commerce-API.production.postman_collection.json`.

```bash
npm run postman:build                              # full collection, production environment
node postman/scripts/build-final-collection.js --folder "06 Categories" --folder "07 Products"   # just these folders
node postman/scripts/build-final-collection.js --env postman/multi-vendor-ecommerce-api.postman_environment.json   # against local instead
```

## Regenerating the final collection after an API change

1. Edit the **source** collection (`multi-vendor-ecommerce-api.postman_collection.json`) — new/changed endpoint, new field, new test assertion.
2. `npm run postman:build` (add `--folder` to scope it to just the changed area).
3. Check the printed coverage line; commit both the source and the regenerated `.production.` file together.

Never hand-edit an example in the `.production.` file directly — the next `postman:build` run overwrites it with whatever the API actually returned, so a hand-edited example is not documentation, it's a lie waiting to be silently discovered.

## Production data created by this suite

Vendor/Shop/Product/Category have **no DELETE endpoint** in this API (only `ProductImage` and `CartItem` do) — records this suite creates in production cannot be cleaned up through the API itself. Every record it creates is therefore deliberately named `QA Test ...` / `qa-test-...` so it's unambiguous in the database that it's a test fixture, never a real customer/vendor record. If you want them gone, that's a direct database delete (`DELETE FROM vendors WHERE business_name LIKE 'QA Test Vendor%'` and cascading from there) — not something this suite performs on its own.
