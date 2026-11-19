# Verification

Run `node --test integration/test/integration.test.js` from the repo root. The local tests use injected test doubles for Zoho and HTTP through the actual Node listener. The live tests require authorized Zoho accounts, a hosted service and Commerce preview or publication.

| Test case | Expected | Actual | Status | Evidence | Required fix or action |
| --- | --- | --- | --- | --- | --- |
| Local input validation | Reject empty name, invalid email, zero/negative/fractional quantity, malformed node, HTML name and honeypot | All eight inputs rejected | Pass | Node tests 1–8 | None |
| Local confidentiality and CORS | Public response has only four fields and unapproved origin is denied | Exact response assertion passed | Pass | Node test 9 | Repeat against live public pages |
| Local RFQ and upstream failure | Correct lookup and status, unknown node rejected, failure reports 503 without private data | Observed expected statuses, safe response and mapped test record | Pass | Node test 10 | Repeat against live Creator |
| Local duplicate and rate limit | Concurrent duplicate saves once and sixth request is accepted before rate limit triggers | One fake record, seventh HTTP request returned 429 | Pass | Node tests 11–12 | Verify persistence-level unique constraint in Creator |
| Local sync and recovery | Payload allowlists fields, repeat run updates, ambiguous POST is held | All mapping, update and retry assertions passed | Pass | Node tests 13–15 | Run against authorized Commerce |
| Chrome fixture at 375px, 768px, 1440px | Three cards, no horizontal overflow, correct modal node and fixture RFQ confirmation | All widths and all three nodes passed, no uncaught errors observed | Pass | integration/tools/browser-check.mjs output | Repeat in the actual Commerce theme |
| Creator seeds, lookup relationships and duplicate field validation | Exactly three rows in each related form, duplicate IDs and invalid values rejected | Account unavailable | Blocked | Schema and seed source | Configure Creator and run create/edit rejection tests |
| Creator access restrictions | Private pages deny signed-out buyers and restricted integration identities | Account unavailable | Blocked | Permission matrix in schema | Test as buyer, staff and both identities |
| Commerce product synchronization | Three matching masked items, rerun keeps same IDs, successful logs | API account unavailable | Blocked | Sync command and log schema | Run twice and compare admin product IDs and logs |
| Product display | Three cards with correct node, dosage, certification and MOQ | Live storefront unavailable | Blocked | Commerce theme source | Verify all fields in preview and take a screenshot |
| Native product, search, direct cart and checkout | No prices, purchase controls or working retail checkout path | Live storefront unavailable | Blocked | Setup and deployment docs | Inspect signed-out pages, rendered DOM, and request behavior |
| Live RFQs | Every product writes one correct Creator lookup and status New, including repeated submissions | OAuth and hosting unavailable | Blocked | RFQ source | Submit once per node, repeat one, and verify the private report |
| Live error paths | Validation and outages show actionable messages and no false success | Live service unavailable | Blocked | RFQ source | Test invalid fields, unlisted node, offline network, reduced-scope or revoked grant |
| Live confidentiality | No plant names, addresses, licence numbers, molecule names or OAuth secrets in public content or traffic | Live storefront unavailable | Blocked | Allowlist code | Inspect source, descriptions, metadata, bundle, search, catalog and Network responses |
| 375px, 768px, 1440px | No overflow or inaccessible actions, visible modal and clear confirmation | Live storefront unavailable | Blocked | Theme assets | Exercise catalog and modal at all widths with browser DevTools |
| Console and external preview URL | Reviewer URL loads with no critical console errors | No URL yet | Blocked | Deployment instructions | Verify in a clean browser and record URL |

For live evidence, capture timestamp, URL, node, expected result and observed result. Save only sanitized screenshots or traffic excerpts and keep full Creator and network exports private.

### Reproduce the local browser check

Run `node integration/tools/browser-check.mjs "C:/Program Files/Google/Chrome/Application/chrome.exe"` from the repository root, substituting your Chrome binary path. This renders the actual generated Commerce section in Chrome using a loopback HTTP fixture for the catalog and RFQ endpoints. It does not exercise the Zoho theme, OAuth, CORS against a live store, or Creator persistence.

