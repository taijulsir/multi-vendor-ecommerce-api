#!/usr/bin/env node
/**
 * Builds the FINAL, importable Postman collection
 * (postman/Multi-Vendor-E-Commerce-API.production.postman_collection.json)
 * from the audited SOURCE collection
 * (postman/multi-vendor-ecommerce-api.postman_collection.json) by
 * actually running it against a real environment with Newman and
 * inserting genuine, sanitized captured responses as saved Postman
 * "response" examples.
 *
 * This is the ONLY supported way to (re)populate examples in the final
 * collection -- never hand-edit example bodies, and never invent a
 * response that wasn't actually observed. See docs/postman-testing.md
 * "How examples are generated/refreshed".
 *
 * Usage:
 *   node postman/scripts/build-final-collection.js [--env <path>] [--folder "<name>" ...]
 *
 * Defaults to postman/Production.postman_environment.json and runs the
 * whole collection. Pass one or more --folder flags to run (and only
 * update examples for) a subset -- useful for re-running just the
 * folders that were previously blocked, without disturbing examples
 * already captured for everything else (this script only ever REPLACES
 * the example for an item it actually executed this run; every other
 * item's existing example is left untouched).
 *
 * Exits non-zero if Newman itself errors. A failed assertion inside a
 * request does NOT abort the script -- see INSERT POLICY below; the
 * run's own pass/fail summary is still printed and Newman's own exit
 * code from a plain `npm run test:api` is what CI should key off, not
 * this script.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const newman = require('newman');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_COLLECTION = path.join(ROOT, 'postman', 'multi-vendor-ecommerce-api.postman_collection.json');
const OUTPUT_COLLECTION = path.join(ROOT, 'postman', 'Multi-Vendor-E-Commerce-API.production.postman_collection.json');
const DEFAULT_ENV = path.join(ROOT, 'postman', 'Production.postman_environment.json');

// Folders whose items intentionally exercise non-2xx/failure paths --
// an example is inserted for these regardless of the item's own
// pm.test() pass/fail, since the whole point is to document that
// specific status code. Every other folder only gets an example when
// the item's own tests all passed this run (a "canonical success"
// policy) -- a 404 that only happened because an earlier, still-blocked
// step in the SAME folder never ran is noise, not documentation, and is
// deliberately never baked in.
const ALWAYS_CAPTURE_FOLDERS = new Set(['00 Admin Setup', '18 Security & Negative Tests']);

// Keys whose string values are replaced wholesale, wherever they appear
// in a response body or the "Authorization" header of a captured
// request -- preserves the field's presence/shape (so the example still
// documents "this response has an accessToken") without ever writing a
// real bearer token, refresh token, or hash into a file that gets
// committed to git.
const SENSITIVE_BODY_KEYS = new Set([
  'accessToken', 'refreshToken', 'adminAccessToken', 'token',
  'passwordHash', 'tokenHash', 'password', 'adminPassword',
]);

function redactBody(value) {
  if (Array.isArray(value)) return value.map(redactBody);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_BODY_KEYS.has(k) && typeof v === 'string') {
        out[k] = '<REDACTED>';
      } else {
        out[k] = redactBody(v);
      }
    }
    return out;
  }
  return value;
}

function redactHeaders(headers) {
  return (headers || []).map((h) => {
    if (String(h.key).toLowerCase() === 'authorization') {
      return { ...h, value: 'Bearer <REDACTED>' };
    }
    return h;
  });
}

/** Flat name -> { item, folderName } map over every leaf request in the collection tree. */
function indexRequests(items, folderName, out) {
  for (const it of items) {
    if (it.item) {
      indexRequests(it.item, it.name, out);
    } else {
      if (out.has(it.name)) {
        throw new Error(
          `Duplicate request name "${it.name}" across the collection -- ` +
          'this script matches Newman executions to collection items by ' +
          'name and requires every leaf request name to be unique.'
        );
      }
      out.set(it.name, { item: it, folderName });
    }
  }
}

function buildExampleName(code, folderName) {
  const STATUS_TEXT = {
    200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request',
    401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
    413: 'Payload Too Large',
  };
  const text = STATUS_TEXT[code] || String(code);
  if (code >= 200 && code < 300) return 'Success';
  return `${code} ${text}`;
}

function redactRequestBody(body) {
  // The captured request body reflects Newman's ACTUAL sent request --
  // i.e. with {{variables}} already substituted to their real runtime
  // values (a real password, a real captured token in a later step,
  // ...). This is genuinely different from the SOURCE collection's own
  // committed body (which still holds the {{template}} placeholders,
  // safe by construction) -- redact it the same way as a response body,
  // on the same sensitive-key list, or an admin credential ends up in
  // committed plaintext (see this script's own build history: this
  // exact mistake happened once, to "00 Admin Setup"'s captured
  // example, before this function existed).
  if (!body || body.mode !== 'raw' || typeof body.raw !== 'string') return body;
  try {
    const parsed = JSON.parse(body.raw);
    return { ...body, raw: JSON.stringify(redactBody(parsed), null, 2) };
  } catch {
    return body; // not JSON -- nothing to redact
  }
}

function toOriginalRequest(execRequest) {
  // execRequest is a postman-collection SDK Request instance when it
  // comes straight out of newman.run()'s programmatic callback (NOT a
  // plain object -- only the JSON/CLI reporters trigger that
  // serialization). .toJSON() is the SDK's own, correct conversion; do
  // not hand-roll it from raw property access, which silently produces
  // wrong/empty output (see this script's own build history).
  const plain = execRequest.toJSON();
  return {
    method: plain.method,
    header: redactHeaders(plain.header),
    url: plain.url,
    body: redactRequestBody(plain.body),
  };
}

function buildExample({ item, execution, folderName }) {
  const res = execution.response;
  const headerList = res.headers && typeof res.headers.toJSON === 'function' ? res.headers.toJSON() : [];
  const isBinary = headerList.some(
    (h) => String(h.key).toLowerCase() === 'content-type' && /^image\//.test(h.value),
  );

  let bodyText = '';
  if (!isBinary && Buffer.isBuffer(res.stream)) {
    const raw = res.stream.toString('utf-8');
    try {
      const parsed = JSON.parse(raw);
      bodyText = JSON.stringify(redactBody(parsed), null, 2);
    } catch {
      bodyText = raw; // not JSON (e.g. empty 204 body) -- keep as-is
    }
  }

  const usefulHeaderNames = new Set(['content-type', 'content-disposition', 'x-content-type-options']);
  const header = headerList
    .filter((h) => usefulHeaderNames.has(String(h.key).toLowerCase()))
    .map((h) => ({ key: h.key, value: h.value }));

  return {
    name: isBinary
      ? `${buildExampleName(res.code, folderName)} (binary image stream -- body not embedded, see description)`
      : buildExampleName(res.code, folderName),
    originalRequest: toOriginalRequest(execution.request),
    status: res.status,
    code: res.code,
    _postman_previewlanguage: isBinary ? 'text' : 'json',
    header,
    cookie: [],
    body: isBinary
      ? '<binary image data -- not embedded in this example; verified live via GET on an ACTIVE product\'s image, Content-Type was ' +
        (headerList.find((h) => String(h.key).toLowerCase() === 'content-type') || {}).value
      : bodyText,
  };
}

async function run({ envPath, folders }) {
  if (!fs.existsSync(SOURCE_COLLECTION)) {
    throw new Error(`Source collection not found: ${SOURCE_COLLECTION}`);
  }
  const sourceCollection = JSON.parse(fs.readFileSync(SOURCE_COLLECTION, 'utf-8'));

  // Load (or reuse, if this is a rebuild) the existing final collection as
  // the base to merge into, so examples captured in previous runs for
  // folders NOT included this run are preserved untouched.
  const baseCollection = fs.existsSync(OUTPUT_COLLECTION)
    ? JSON.parse(fs.readFileSync(OUTPUT_COLLECTION, 'utf-8'))
    : JSON.parse(JSON.stringify(sourceCollection));

  // Always resync structure/requests/tests from the source (the source
  // collection is the one place bodies/tests/variables are edited by
  // hand) -- only `response` (examples) arrays are ever carried forward
  // from the previous final-collection build.
  const previousExamples = new Map();
  {
    const idx = new Map();
    indexRequests(baseCollection.item, null, idx);
    for (const [name, { item }] of idx) {
      if (item.response && item.response.length) previousExamples.set(name, item.response);
    }
  }

  const freshCollection = JSON.parse(JSON.stringify(sourceCollection));
  const freshIndex = new Map();
  indexRequests(freshCollection.item, null, freshIndex);
  for (const [name, { item }] of freshIndex) {
    if (previousExamples.has(name)) item.response = previousExamples.get(name);
  }

  console.log(`Running Newman against: ${envPath}`);
  if (folders.length) console.log(`Restricted to folders: ${folders.join(', ')}`);

  const summary = await new Promise((resolve, reject) => {
    newman.run(
      {
        collection: sourceCollection,
        environment: JSON.parse(fs.readFileSync(envPath, 'utf-8')),
        folder: folders.length ? folders : undefined,
        workingDir: path.join(ROOT, 'postman'), // resolves the image-upload fixture's relative src path
        reporters: [],
      },
      (err, summary) => (err ? reject(err) : resolve(summary)),
    );
  });

  const run = summary.run;
  const failureRefs = new Set(run.failures.map((f) => f.cursor.ref));

  let inserted = 0;
  let skippedFailed = 0;
  for (const execution of run.executions) {
    const item = execution.item;
    const entry = freshIndex.get(item.name);
    if (!entry) {
      console.warn(`WARNING: executed item "${item.name}" not found in source collection index -- skipping.`);
      continue;
    }
    const passed = !failureRefs.has(execution.cursor.ref);
    const shouldCapture = passed || ALWAYS_CAPTURE_FOLDERS.has(entry.folderName);
    if (!shouldCapture) {
      skippedFailed += 1;
      continue;
    }
    const example = buildExample({ item, execution, folderName: entry.folderName });
    entry.item.response = [example];
    inserted += 1;
  }

  fs.writeFileSync(OUTPUT_COLLECTION, JSON.stringify(freshCollection, null, '\t') + '\n');

  console.log(`\nExamples inserted/refreshed this run: ${inserted}`);
  console.log(`Executions skipped (failed, non-security folder -- no example inserted): ${skippedFailed}`);
  console.log(`Newman assertions: ${run.stats.assertions.total - run.stats.assertions.failed}/${run.stats.assertions.total} passed`);
  console.log(`Written: ${path.relative(ROOT, OUTPUT_COLLECTION)}`);

  return { run, inserted, skippedFailed };
}

function parseArgs(argv) {
  const args = { envPath: DEFAULT_ENV, folders: [] };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--env') args.envPath = path.resolve(argv[++i]);
    else if (argv[i] === '--folder') args.folders.push(argv[++i]);
  }
  return args;
}

if (require.main === module) {
  run(parseArgs(process.argv)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
