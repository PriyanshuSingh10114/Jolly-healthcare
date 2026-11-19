import { createHash } from 'node:crypto';
import { isId, nodePattern, publicProduct } from './zoho.js';

export class InputError extends Error {}

export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Invalid request.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (body.website !== '') throw new InputError('Invalid request.');
  if (typeof body.node !== 'string' || !nodePattern.test(body.node)) throw new InputError('Choose a formulation.');
  if (!name || name.length > 100 || /[<>\u0000-\u001f\u007f]/.test(name)) {
    throw new InputError('Enter a name of up to 100 characters.');
  }
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) ||
      email.split('@')[0].length > 64 || /(^\.|\.\.|\.\@)/.test(email)) {
    throw new InputError('Enter a valid email address.');
  }
  if (!Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 999999999) {
    throw new InputError('Enter a whole quantity from 1 to 999,999,999.');
  }
  return { node: body.node, name, email, quantity: body.quantity };
}

const publicFields = 'ID,Masked_Node_ID,Dosage_Form,Certification,MOQ,Commerce_Product_ID';
const availability = 'Sync_Status == "Synced"';

export async function catalog(db) {
  const rows = await db.read('RFQ_Catalog', publicFields, availability);
  return rows.filter(row => isId(row.Commerce_Product_ID)).map(publicProduct);
}

export async function submit(db, input) {
  const rows = await db.read('RFQ_Catalog', publicFields,
    availability + ' && Masked_Node_ID == "' + input.node + '"');
  if (!rows.length) throw new InputError('This formulation is unavailable.');
  const formulation = rows[0];
  if (rows.length !== 1 || !isId(formulation.ID) ||
      !isId(formulation.Commerce_Product_ID) || publicProduct(formulation).node !== input.node) {
    throw new Error('Unexpected formulation mapping');
  }
  const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const exists = async () => {
    const matches = await db.read('RFQ_Receipts', 'ID', 'Submission_Key == "' + key + '"');
    return matches.length === 1 && isId(matches[0].ID);
  };
  if (await exists()) return;
  try {
    await db.add('RFQ_Inquiries', {
      Submission_Key: key,
      Masked_Node_ID: input.node,
      Formulation_Reference: formulation.ID,
      Buyer_Name: input.name,
      Buyer_Email: input.email,
      Target_Quantity: input.quantity,
      Inquiry_Status: 'New',
    });
  } catch (error) {
    if (!(await exists())) throw error;
  }
}

