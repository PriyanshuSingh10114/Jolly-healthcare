# JollyRx Security Architecture and Audit Guide

Security is the primary design pillar of the JollyRx B2B contract manufacturing platform. JollyRx's business model depends on strict anonymity: contract manufacturing plants must be discoverable by their production capabilities (dosage form, certification, minimum order quantity) without revealing proprietary plant identities, physical addresses, drug licence numbers, site master files, or molecule associations to prospective buyers until vetted offline by the JollyRx brokerage desk.

---

## 1. Threat Model & Data Classification

### Data Classification Matrix

| Data Asset | Sensitivity | Storage Location | Publicly Accessible? | Safeguards |
| :--- | :--- | :--- | :--- | :--- |
| **Real Plant Name** | **Confidential** | Zoho Creator `Plant_Master` | **NO** | Restricted report permissions; strictly excluded from all public sync transformations and API payloads. |
| **Factory Address** | **Confidential** | Zoho Creator `Plant_Master` | **NO** | Excluded from sync; never serialized in client bundles. |
| **Drug Licence Number** | **Confidential** | Zoho Creator `Plant_Master` | **NO** | Stored in vault; validated with unique constraint; private report view only. |
| **Site Master File** | **Confidential** | Zoho Creator `Plant_Master` (Optional upload) | **NO** | Internal admin view only; download links never exposed. |
| **Molecule** | **Confidential** | Zoho Creator `Formulations` | **NO** | Explicitly excluded from `RFQ_Catalog` report projection and Commerce sync payload. |
| **Masked Node ID** | **Public** | Creator, Commerce, RFQ | **YES** | Synthetic identifier format (`NODE-[A-Z]{2}-\d{2}`). Verified immutable via Deluge. |
| **Dosage Form** | **Public** | Creator, Commerce | **YES** | Standard pharmaceutical classifications (Tablets, Capsules, Injectables). |
| **Certification** | **Public** | Creator, Commerce | **YES** | Regulatory standards (WHO-GMP, Schedule M). |
| **MOQ** | **Public** | Creator, Commerce | **YES** | Numeric order threshold. Enforced positive integer. |
| **Buyer Contact & RFQ** | **Restricted** | Zoho Creator `RFQ_Inquiries` | **NO** | Write-only via backend service; read-only for internal JollyRx brokers. |
| **OAuth Credentials** | **Critical Secret**| Environment Variables / Zoho Secrets Manager | **NO** | Zero client-side leakage; strictly held in backend server process. |

---

## 2. Security Architecture Principles

### 2.1 The Vault Isolation Pattern (Zero-Trust Projection)
- **Allowlist-Only Serialization**: The synchronization engine (`sync.js` / `sync-to-commerce.deluge`) does **not** fetch a full plant record and redact confidential properties. Instead, it reads a narrow projection report (`Sync_Formulations`) that contains strictly the four public fields: `Masked_Node_ID`, `Dosage_Form`, `Certification`, and `MOQ`.
- **Field Whitelist Verification**: Automated tests (`integration.test.js`) enforce that every synced payload matches an exact allowlist:
  ```javascript
  ['name', 'product_description', 'product_short_description', 'show_in_storefront', 'url', 'variant_type', 'variants']
  ```
  Any attempt to add unauthorized fields throws an immediate assertion failure.

### 2.2 Client-Side Credential Elimination
- Zoho Creator OAuth tokens and Commerce API keys are **never** delivered to client browsers.
- The storefront communicates solely with the intermediary RFQ microservice (`integration/src/server.js`) via standard JSON requests.
- The RFQ service authenticates upstream requests to Zoho Creator v2.1 API using platform-managed refresh tokens stored in host environment variables (`Z_CREATOR_REFRESH`, `Z_CREATOR_CLIENT`, `Z_CREATOR_SECRET`).

### 2.3 Strict CORS & Origin Defense
- The RFQ endpoint rejects any incoming cross-origin request whose `Origin` header does not match the configured `STOREFRONT_ORIGIN`:
  ```javascript
  if (req.headers.origin !== origin) return reply(403, { error: 'Origin denied.' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  ```
- Preflight `OPTIONS` requests are handled explicitly with restrictive headers (`Content-Type` only, `GET` for `/catalog`, `POST` for `/rfq`).

### 2.4 Server-Side Input Validation & Sanitization
Client-side HTML5 validation is treated purely as a user convenience. The backend enforces strict structural and semantic validation:
- **Masked Node ID**: Enforced strictly against `/^NODE-[A-Z]{2}-\d{2}$/`. SQL/Deluge injection patterns (`" || ID != 0`) are rejected immediately.
- **Buyer Name**: Maximum 100 characters. Control characters (`\u0000-\u001f\u007f`) and HTML brackets (`<`, `>`) are blocked to prevent stored XSS or control injection.
- **Buyer Email**: RFC 5322-compliant syntax check, maximum 254 characters total, 64 characters before `@`, blocking consecutive dots and malformed domains.
- **Target Quantity**: Enforced integer between `1` and `999,999,999`. Zero, negative numbers, fractions, and non-numeric inputs are rejected with HTTP 400.
- **Honeypot Anti-Spam Field**: An invisible field `website` is presented in the form. Automated bots filling all available fields submit non-empty strings; the backend immediately drops the request with a generic rejection.

### 2.5 Replay Protection & Idempotent Persistence
- Concurrent or repeated RFQ submissions are deduplicated using a cryptographic SHA-256 fingerprint:
  $$\text{Key} = \text{SHA-256}(\text{JSON}(\text{node}, \text{name}, \text{email}, \text{quantity}))$$
- Before executing a Creator insert, the backend queries the internal `RFQ_Receipts` report for existing records with that `Submission_Key`.
- If a record exists, the request returns success without creating a duplicate record or triggering redundant downstream notifications.
- The Creator schema enforces uniqueness on `Submission_Key` at the database level to resolve race conditions between concurrent worker threads.

### 2.6 Rate Limiting & DoS Protection
- **Per-IP Rate Limiter**: The backend maintains an in-memory sliding window bucket keyed by client IP (`req.socket.remoteAddress`).
  - `/catalog`: Max 60 requests/minute.
  - `/rfq`: Max 6 requests/minute.
  - Exceeding limits triggers an immediate `HTTP 429 Too Many Requests` with `Retry-After: 60`.
- **Payload Size Capping**: Inbound HTTP request streams are capped at 4,096 bytes (4 KB). Excessively large payloads trigger `HTTP 413 Request too large` and close the underlying socket.
- **Request Timeouts**: Strict 12-second HTTP server socket timeout and 8-second upstream fetch timeouts prevent connection starvation.

---

## 3. Data Leakage Audit & Inspection Procedures

To verify that no confidential manufacturer data leaks to unauthorized observers, execute the following audit checklist across all storefront surfaces:

### Inspection Surface Checklist

| # | Inspection Surface | Audit Method | Expected Result | Pass Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Browser Network Tab** | Inspect all `/catalog` and `/rfq` HTTP responses. | Only `node`, `dosage`, `certification`, and `moq` are present. | Zero plant names, addresses, licence numbers, or molecules in JSON payload. |
| **2** | **Storefront HTML Source** | View Page Source (`Ctrl+U`) on Zoho Commerce. | No hidden fields or data attributes with plant identifiers. | No confidential text in HTML comments (`<!-- -->`), data attributes (`data-*`), or script tags. |
| **3** | **JavaScript Assets** | Inspect bundle sources (`jollyrx.js` and theme assets). | Code contains only UI rendering logic and API calls. | No hardcoded API keys, OAuth client secrets, or private seed arrays. |
| **4** | **Product Metadata & Schema** | Check HTML `<head>`, OpenGraph tags, and JSON-LD schema. | Metadata references only public Node IDs. | No plant names or private registration data in meta tags. |
| **5** | **Storefront Search Results** | Search for real plant names (e.g., "Biopharma", "Gujarat", "Baddi") in Commerce search. | Zero search results returned. | Search index contains only public product names (`NODE-BD-01`). |
| **6** | **Server Logs** | Inspect Node.js console logs and stdout/stderr streams. | Logs record route, masked node ID, and operation status. | No buyer email addresses, buyer names, request bodies, or OAuth tokens in server output. |
| **7** | **Error Responses** | Force API errors (e.g., network failure, bad database token). | Clean, generic user-facing message returned (`503 Service temporarily unavailable`). | No internal stack traces, database schema details, or upstream credentials leaked in error bodies. |

---

## 4. Least-Privilege Zoho Access Controls

### 4.1 Zoho Creator Permission Roles

| Role / Identity | `Plant_Master` | `Formulations` | `RFQ_Inquiries` | `Sync_Logs` | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Public Storefront** | **No Access** | **No Access** | **No Access** | **No Access** | All public access to Creator reports is disabled. Forms are unpublished. |
| **RFQ Service Identity** | No Access | **Read Only** (via `RFQ_Catalog` view: excludes plant lookup and molecule) | **Create Only** + Read receipt keys (`RFQ_Receipts`) | No Access | Restricted OAuth client with minimal scopes (`ZohoCreator.report.READ`, `ZohoCreator.form.CREATE`). |
| **Sync Service Identity** | No Access | **Read + Update** (via `Sync_Formulations` view) | No Access | **Create Only** (`Sync_Logs`) | Dedicated sync OAuth client. Cannot read plant master or inquiries. |
| **JollyRx Broker (Staff)**| Read Only | Read Only | **Read + Update** (Status: In Review, Closed) | Read Only | Internal administrative users authenticated via Zoho Directory with MFA. |
| **Administrator** | Full Access | Full Access | Full Access | Full Access | App owner; manages schema and Deluge functions. |

### 4.2 OAuth Scope Segregation
Rather than sharing a single monolithic superuser credential, the architecture strictly segregates scopes into two independent client credentials:
1. **RFQ Gateway Client**:
   - `ZohoCreator.report.READ` (scoped strictly to `RFQ_Catalog` and `RFQ_Receipts`)
   - `ZohoCreator.form.CREATE` (scoped strictly to `RFQ_Inquiries`)
2. **Catalog Sync Client**:
   - `ZohoCreator.report.READ`, `ZohoCreator.report.UPDATE` (for formulation mapping)
   - `ZohoCreator.form.CREATE` (for audit log persistence)
   - `ZohoCommerce.items.CREATE`, `ZohoCommerce.items.UPDATE` (for product creation)

---

## 5. Security Verification Summary

All core security guarantees are backed by automated tests in `integration/test/integration.test.js`:
- ✅ Empty / invalid names rejected (`assert.throws`)
- ✅ Malformed emails rejected (regex & RFC checks)
- ✅ Negative, fractional, and zero quantities rejected
- ✅ Injection payloads in Node ID rejected (`" || ID != 0`)
- ✅ HTML / XSS payloads in Name rejected (`<script>`)
- ✅ Spam bot honeypot detection verified (`website: "spam"`)
- ✅ Public catalog strictly allowlists 4 public fields and verifies CORS headers
- ✅ Upstream database failures sanitized to generic 503 without leaking stack traces
- ✅ Rate limiting triggers HTTP 429 after 6 RFQ requests
- ✅ Concurrent submissions resolve to 1 idempotent database insert
- ✅ Product synchronization payload contains zero references to private plant metadata
