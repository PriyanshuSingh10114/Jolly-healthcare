import { open, unlink } from 'node:fs/promises';
import { commerce, creator, isId, publicProduct, ZohoError } from './zoho.js';

const report = 'Sync_Formulations';

export function productPayload(row, creating) {
  const { node, dosage, certification, moq } = publicProduct(row);
  const description = 'Dosage form: ' + dosage + ' | Certification: ' + certification + ' | MOQ: ' + moq;
  return {
    name: node,
    url: node.toLowerCase(),
    product_short_description: description,
    product_description: '<p>' + description + '</p>',
    ...(creating && { variant_type: 'inventory', show_in_storefront: false,
      variants: [{ rate: '1', initial_stock: '0', sku: node }] }),
  };
}

export async function synchronize(db, saveProduct) {
  const rows = await db.read(report,
    'ID,Masked_Node_ID,Dosage_Form,Certification,MOQ,Commerce_Product_ID,Sync_Status');
  if (rows.length !== 3 || new Set(rows.map(row => publicProduct(row).node)).size !== 3) {
    throw new Error('Expected three unique formulations');
  }
  const productIds = rows.map(row => row.Commerce_Product_ID).filter(Boolean);
  if (productIds.some(id => !isId(id)) || new Set(productIds).size !== productIds.length ||
      rows.some(row => !isId(row.ID))) throw new Error('Invalid existing product mapping');
  let failed = false;
  for (const row of rows) {
    let productId = row.Commerce_Product_ID;
    const node = row.Masked_Node_ID;
    let operation = productId ? 'Update' : 'Create';
    let status = 'Synced';
    let message = '';
    try {
      if (!productId) {
        if (row.Sync_Status !== 'Pending') {
          operation = 'Reconcile';
          throw new Error('Reconcile previous create attempt');
        }
        await db.update(report, row.ID, { Sync_Status: 'Creating' });
      }
      productId = await saveProduct(productPayload(row, !productId), productId);
      if (!isId(productId)) throw new Error('Missing confirmed Commerce product ID');
      await db.update(report, row.ID, { Commerce_Product_ID: productId, Sync_Status: 'Synced' });
    } catch (error) {
      failed = true;
      status = 'Error';
      message = error instanceof ZohoError ? [error.message, error.status, error.code].filter(value => value !== undefined).join(' ') :
        operation === 'Reconcile' ? 'Check existing Commerce product by SKU before retrying' : 'Operation could not be confirmed';
      console.error(JSON.stringify({ node, operation, message, commerceProductId: productId || undefined }));
      try {
        await db.update(report, row.ID, { Sync_Status: 'Error',
          ...(isId(productId) && { Commerce_Product_ID: productId }) });
      } catch {
        console.error(JSON.stringify({ node, operation: 'PersistFailureStatus' }));
      }
    }
    try {
      await db.add('Sync_Logs', { Masked_Node_ID: node, Operation: operation, Status: status,
        ...(message && { Error_Message: message }) });
    } catch {
      failed = true;
      console.error(JSON.stringify({ node, operation: 'WriteSyncLog' }));
    }
  }
  return !failed;
}

async function main() {
  const lock = new URL('../sync.lock.local', import.meta.url);
  const descriptor = await open(lock, 'wx');
  try {
    if (!(await synchronize(creator('Z_SYNC'), commerce()))) process.exitCode = 1;
  } finally {
    await descriptor.close();
    await unlink(lock);
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith('sync.js')) {
  main().catch(error => {
    console.error(error instanceof ZohoError ? error.message + ' ' + error.status : 'Sync stopped. Check configuration and lock.');
    process.exitCode = 1;
  });
}

