# Deployment

## RFQ service

1. Provision one Node.js 22 service instance with public HTTPS and a health probe at /healthz. Its process entry point is `node src/server.js` from the integration directory when the host injects environment variables. Locally, copy .env.example to .env and use `npm start`.
2. Inject only STOREFRONT_ORIGIN, PORT and Z_CREATOR_* variables into the RFQ service. Enter the exact public Commerce origin with no path. Preview origins may differ from the public host and need a dedicated test configuration. Use explicit local or host-managed secrets and exclude them from logs.
3. At TLS ingress, apply per-client IP rate limits, cap request bodies and set a response timeout long enough for Zoho calls. The app's in-memory rate limit is per TCP peer, so behind a proxy its limit may be shared among visitors. Use one instance for this demo and confirm normal traffic through the chosen ingress.
4. Confirm /healthz responds and exercise /catalog with the configured Origin. The health probe verifies the process only.

## Sync

1. On a trusted workstation, use the integration directory .env containing Z_SYNC_* plus Z_COMMERCE_API, Z_STORE_ORG, Z_CREATOR_API, Z_CREATOR_OWNER and Z_CREATOR_APP. Match all hosts to your documented data center.
2. Run `npm run sync` from integration. Confirm three Creator product IDs and successful logs. Repeat the command and verify product count is unchanged. Run the job from a single directory on a single host. For scheduled synchronization, use one non-overlapping job on that host.
3. Investigate partial failures using [recovery guidance](api-integration.md). Verify products in Commerce admin before exposing a preview.

## Commerce theme

1. Generate the section source from the repository root with `node commerce/build-section.mjs https://YOUR-INTEGRATION-HOST`. Paste stdout into a Custom Code section in the dedicated Commerce theme. On a legacy theme, add the HTML where the builder permits embed code, CSS to Custom CSS, and JS inside a footer script. Replace __JOLLYRX_API__ with the HTTPS endpoint origin in the HTML. No credentials belong in these settings.
2. Place the section on the Commerce homepage. Remove duplicate header content and unnecessary retail sections with the theme editor. Remove native cart, wishlist, retail search and checkout links where the theme supports it. Keep native products hidden while verifying the storefront.
3. Preview desktop/mobile, then test the same URL in a clean browser, including a real RFQ and Creator verification. If code snippets only execute after publication, use a dedicated demo store and obtain publishing approval before making changes that go live. Record only the URL that actually loads and completes the flow.

