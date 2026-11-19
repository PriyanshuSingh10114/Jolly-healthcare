# JollyRx System Architecture & Design Specification

This document provides the technical architecture, data flows, integration pathways, and component specifications for the **JollyRx B2B Pharmaceutical Contract Manufacturing Platform**.

---

## 1. System Overview & Architecture Diagram

JollyRx operates on a decoupled two-tier architecture:
1. **Internal Private Vault (Zoho Creator)**: Secure repository holding sensitive manufacturer records, regulatory licences, plant locations, and confidential formulations.
2. **Public B2B Storefront (Zoho Commerce)**: Buyer-facing catalog showcasing sanitized manufacturing capabilities, masked node identifiers, dosage forms, certifications, and MOQs with an RFQ-only purchasing workflow.

```mermaid
flowchart TD
  subgraph PrivateVault ["Private Zoho Creator Vault"]
    PM["Plant_Master\n(Real Name, Address, Licence, Masked Node)"]
    FM["Formulations\n(Lookup, Molecule, Dosage, Cert, MOQ)"]
    RFQ["RFQ_Inquiries\n(Buyer Name, Email, Target Qty, Status)"]
    LOGS["Sync_Logs\n(Operation, Status, Error Audit Trail)"]
    PM -->|Lookup Relationship| FM
    RFQ -.->|Formulation Lookup| FM
  end

  subgraph SyncEngine ["Catalog Transformation & Synchronization"]
    SYNC["Sync Service / Deluge Workflow\n(Strict Allowlist Extraction)"]
    FM -->|Authorized Read| SYNC
    SYNC -->|Idempotent Creation / Update| COMM_API["Zoho Commerce Product API"]
    COMM_API -->|Product ID + Status| FM
    SYNC -->|Audit Logging| LOGS
  end

  subgraph Storefront ["Zoho Commerce Storefront"]
    PROD["Commerce Catalog\n(Masked SKU, Zero Stock, Hidden Retail)"]
    CUSTOM_SEC["JollyRx Custom B2B Theme Section\n(Responsive Cards, No Prices, No Cart)"]
    MODAL["RFQ Modal Dialog\n(Prefilled Node ID, Buyer Fields)"]
    COMM_API --> PROD
    PROD -.-> CUSTOM_SEC
    CUSTOM_SEC --> MODAL
  end

  subgraph IntegrationService ["Secure RFQ Intermediary Gateway"]
    GATEWAY["Node.js RFQ Microservice\n(Origin Check, Rate Limiter, Honeypot, SHA-256 Key)"]
    MODAL -->|HTTPS POST JSON| GATEWAY
    GATEWAY -->|Validated Record Insert| RFQ
  end
```

---

## 2. End-to-End Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  actor Buyer as Prospective Pharma Buyer
  participant UI as Storefront (Zoho Commerce)
  participant GW as RFQ Gateway Service (Node.js)
  participant ZC as Zoho Creator (Private Vault)

  Buyer->>UI: Visits JollyRx Storefront
  UI->>GW: GET /catalog (Origin Header)
  GW->>ZC: Query RFQ_Catalog (Filtered: Synced only)
  ZC-->>GW: Return public records (Node, Dosage, Cert, MOQ)
  GW-->>UI: JSON { items: [...] }
  UI-->>Buyer: Renders 3 Masked Formulation Cards

  Buyer->>UI: Clicks "Request Quote" on NODE-BD-01
  UI-->>Buyer: Opens Responsive RFQ Modal (prefilled NODE-BD-01)
  Buyer->>UI: Enters Name, Email, Target Quantity & submits
  UI->>UI: Client validation & sets aria-busy="true"
  UI->>GW: POST /rfq { node, name, email, quantity, website: "" }

  GW->>GW: Origin verification & Rate limit check (6/min)
  GW->>GW: Validate input types, string lengths & honeypot
  GW->>GW: Compute SHA-256 submission key
  GW->>ZC: Query RFQ_Receipts for existing Submission_Key
  
  alt Duplicate Submission
    ZC-->>GW: Existing record found
    GW-->>UI: HTTP 200 { ok: true }
  else New Submission
    ZC-->>GW: No match
    GW->>ZC: Verify Formulation_Reference for NODE-BD-01
    ZC-->>GW: Formulation Record Confirmed
    GW->>ZC: POST /form/RFQ_Inquiries (New Inquiry record)
    ZC-->>GW: Created Record ID
    GW-->>UI: HTTP 200 { ok: true }
  end

  UI-->>Buyer: Displays "Request received. The JollyRx team will follow up by email."
```

---

## 3. Mandatory Commerce Field Mapping & Allowlisting

Zoho Commerce requires specific fields upon product creation (`name`, `url`, `variant_type`, and initial `variants`). To comply with platform requirements without leaking manufacturer secrets:

| Zoho Commerce Field | JollyRx Value | Security & Compliance Rationale |
| :--- | :--- | :--- |
| `name` | `Masked_Node_ID` (e.g. `NODE-BD-01`) | Prevents manufacturer name or chemical molecule from appearing as the product title. |
| `url` | Lowercase Node ID (e.g. `node-bd-01`) | Deterministic, nonconfidential URL slug. |
| `product_short_description` | `"Dosage form: Tablets \| Certification: WHO-GMP \| MOQ: 50000"` | Safe public summary string generated strictly from allowlisted attributes. |
| `product_description` | `"<p>Dosage form: Tablets \| ...</p>"` | HTML description containing only public fields. |
| `variant_type` | `"inventory"` | Required by Zoho Commerce for variant configuration. |
| `show_in_storefront` | `false` | Hides the native retail item from standard store collections and search results. |
| `variants[0].sku` | `Masked_Node_ID` | Safe unique SKU identifier. |
| `variants[0].rate` | `"1"` | Zoho Commerce enforces positive price validation on variant creation; nominal rate is suppressed in UI. |
| `variants[0].initial_stock` | `"0"` | Zero inventory prevents accidental checkout flows. |

---

## 4. Retail Workflow Suppression Strategy

Standard e-commerce workflows (Add to Cart, Buy Now, Cart Drawer, Shopping Bag, Retail Checkout, Pricing Badges) are strictly incompatible with B2B contract manufacturing:
1. **Inventory Gating**: All synchronized variants are initialized with `initial_stock: 0` and the store preference is set to **Restrict out-of-stock purchases**. This guarantees that even if a buyer attempts to trigger a native checkout URL, the platform blocks transaction progression.
2. **Template Customization**: In the Zoho Commerce Theme Editor:
   - Price blocks and Add to Cart action buttons are removed from product templates.
   - Header navigation links to Cart and Wishlist are suppressed.
   - Retail payment gateways (Stripe, PayPal, Razorpay) remain disabled in the demo store.
3. **Dedicated B2B Section**: The storefront homepage uses the custom JollyRx section (`commerce/build-section.mjs`), which renders custom cards with an explicit "Request Quote" button opening the asynchronous RFQ modal.

---

## 5. Idempotent Synchronization & Error Recovery

Synchronization between Creator and Commerce operates under strict idempotency guarantees:
- **Lock Protection**: External sync scripts enforce single-writer execution via local process locks (`sync.lock.local`).
- **State Machine**:
  - `Pending`: Initial state after formulation creation or manual reset.
  - `Creating`: Transitional state stamped before initiating the initial Commerce `POST`. Prevents duplicate creations if a network timeout occurs mid-flight.
  - `Synced`: Product ID confirmed and recorded in Creator. Subsequent syncs execute `PUT /products/{id}`.
  - `Error`: Failure state. Logged to `Sync_Logs` with root-cause diagnostic message.
- **Reconciliation Protocol**: If a formulation is in `Creating` state without a confirmed `Commerce_Product_ID`, the engine stops and flags the item for operator reconciliation by SKU before retrying.

---

## 6. Access Control & Scopes Matrix

| Service | Scopes / Permissions | Destination / Target |
| :--- | :--- | :--- |
| **RFQ Gateway** | `ZohoCreator.report.READ` | Read `RFQ_Catalog` (public fields) & `RFQ_Receipts` (receipt hash) |
| **RFQ Gateway** | `ZohoCreator.form.CREATE` | Insert into `RFQ_Inquiries` |
| **Catalog Sync** | `ZohoCreator.report.READ`, `UPDATE` | Read and update `Sync_Formulations` |
| **Catalog Sync** | `ZohoCreator.form.CREATE` | Insert execution logs into `Sync_Logs` |
| **Catalog Sync** | `ZohoCommerce.items.CREATE`, `UPDATE`| Create and update products in Zoho Commerce |
