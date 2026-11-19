# Creator schema

Create four blank forms with exactly the link names below. Mark fields required unless listed as optional. Use Creator's built-in ID, Added Time and Modified Time for internal record IDs and timestamps and label them appropriately in internal reports. Auto numbers are display IDs only.

| Form | Fields |
| --- | --- |
| Plant_Master | Internal_Plant_ID (Auto Number), Real_Plant_Name (Single Line), Factory_Address (Multi Line), Drug_Licence_Number (Single Line, unique), Masked_Node_ID (Single Line, length 10, unique), Site_Master_File (optional upload) |
| Formulations | Formulation_ID (Auto Number), Plant_Reference (single lookup to Plant_Master, display Masked_Node_ID), Masked_Node_ID (Single Line, length 10, unique), Molecule (Single Line), Dosage_Form (dropdown: Tablets, Capsules, Injectables), Certification (dropdown: WHO-GMP, Schedule M), MOQ (Number, digits 9), Commerce_Product_ID (optional Single Line, unique), Sync_Status (dropdown: Pending, Creating, Synced, Error, default Pending), Last_Synced_At (optional Date-Time, see setup) |
| RFQ_Inquiries | RFQ_ID (Auto Number), Masked_Node_ID (Single Line, length 10), Formulation_Reference (single lookup to Formulations, display Masked_Node_ID), Buyer_Name (Single Line, max 100), Buyer_Email (Email), Target_Quantity (Number, digits 9), Inquiry_Status (dropdown: New, In Review, Closed, default New), Submission_Key (Single Line, max 64, unique) |
| Sync_Logs | Log_ID (Auto Number), Masked_Node_ID (Single Line, length 10), Operation (dropdown: Create, Update, Reconcile), Status (dropdown: Synced, Error), Error_Message (optional Multi Line) |

| Report link name | Form | Configuration |
| --- | --- | --- |
| All_Plants | Plant_Master | Private staff only |
| All_Formulations | Formulations | Private staff only |
| All_RFQs | RFQ_Inquiries | Private staff only |
| All_Sync_Logs | Sync_Logs | Private operations only |
| RFQ_Catalog | Formulations | RFQ service read, criteria Sync_Status is Synced, exclude plant lookup and molecule |
| RFQ_Receipts | RFQ_Inquiries | RFQ service read all service submissions, include ID and Submission_Key only |
| Sync_Formulations | Formulations | Sync service read and edit, include ID, Masked_Node_ID, Dosage_Form, Certification, MOQ, Commerce_Product_ID, Sync_Status |

Display IDs, timestamps, and restricted report fields in the appropriate report layouts. Apply application permission sets and record visibility explicitly. Keep all Creator forms and reports unpublished. Avoid deleting plants or formulations referenced by inquiries. Restrict changes to mapping and synchronization fields to integration operations.

