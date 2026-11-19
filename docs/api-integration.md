# API integration and recovery

| Operation | API | Scope |
| --- | --- | --- |
| Resolve formulation and verify receipt | GET /creator/v2.1/data/{owner}/{app}/report/{report} | ZohoCreator.report.READ |
| Create inquiry or sync log | POST /creator/v2.1/data/{owner}/{app}/form/{form} | ZohoCreator.form.CREATE |
| Update mapped formulation | PATCH /creator/v2.1/data/{owner}/{app}/report/{report}, criterion on ID | ZohoCreator.report.UPDATE |
| Create a product | POST /store/api/v1/products | ZohoCommerce.items.CREATE |
| Update a product | PUT /store/api/v1/products/{product_id} | ZohoCommerce.items.UPDATE |

Use the documented regional endpoints and the organization header for Commerce. Preserve platform IDs as decimal strings. Creator requests send field link names and use the formulation record ID as the lookup value. Inspect both HTTP status and platform response code. JSON parsing or an unexpected response triggers a safe error.

The RFQ service refreshes access tokens server-side and retries a read once on HTTP 401. Writes are reconciled by looking up the unique submission key. The deployment can safely recover an RFQ whose create response was lost after persistence. The buyer sees success after a confirmed create or an existing matching receipt.

The sync command is intentionally single-writer. It persists Creating before the initial Commerce POST and saves the product ID immediately once confirmed. Existing mappings receive PUT even after a previous failure. An ambiguous create without a saved ID requires an operator to search by exact SKU in Commerce. If exactly one matching item exists, verify its handle, inventory, visibility and content, then save its product ID in Creator. If there is no match, confirm the original request has finished before resetting the row to Pending. If there are multiple matches, correct the mapping before any retry. A stale local lock after a process crash requires confirming there is no running job before removing it. Each failed operation returns a nonzero command exit and attempts to write a private sync log.

The Commerce create documentation calls for name, URL and variants. The implementation uses one inventory-tracked variant with masked SKU, zero initial stock and a nominal rate of 1 to accommodate rate validation. It starts hidden in the native product catalog. The custom Commerce section reads the synchronized public projection without any retail fields. Validate the native product and cart controls before enabling native visibility.

References: [Creator reads](https://www.zoho.com/creator/help/api/v2.1/get-records.html), [Creator inserts](https://www.zoho.com/creator/help/api/v2.1/add-records.html), [Creator updates](https://www.zoho.com/creator/help/api/v2.1/update-records.html), [Commerce create](https://www.zoho.com/commerce/api/create-a-product-with-variant.html), [Commerce update](https://www.zoho.com/commerce/api/update-a-product.html), [Commerce data centers](https://www.zoho.com/commerce/api/multiple-data-centers.html).

