export class ZohoError extends Error {
  constructor(operation, status, code) {
    super(operation);
    this.status = status;
    this.code = typeof code === 'number' ? code : undefined;
  }
}

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error('Missing ' + key);
  return value;
}

function httpsOrigin(key) {
  const url = new URL(required(key));
  if (url.protocol !== 'https:' || url.href !== url.origin + '/') {
    throw new Error('Expected an HTTPS origin for ' + key);
  }
  return url.origin;
}

function oauth(prefix) {
  const endpoint = httpsOrigin(prefix + '_ACCOUNTS') + '/oauth/v2/token';
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: required(prefix + '_REFRESH'),
    client_id: required(prefix + '_CLIENT'),
    client_secret: required(prefix + '_SECRET'),
  });
  let cached;
  let refreshing;
  return async function token(rejected) {
    if (cached?.value === rejected) cached = undefined;
    if (cached && Date.now() < cached.expiry) return cached.value;
    refreshing ??= (async () => {
      const response = await fetch(endpoint, {
        method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (!response.ok || typeof data.access_token !== 'string' || !Number.isFinite(+data.expires_in)) {
        throw new ZohoError('oauth', response.status);
      }
      cached = { value: data.access_token, expiry: Date.now() + (+data.expires_in - 60) * 1000 };
      return cached.value;
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
}

export const isId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
export const nodePattern = /^NODE-[A-Z]{2}-\d{2}$/;

async function api(token, url, method, operation, body, extraHeaders = {}) {
  const send = access => fetch(url, {
    method,
    headers: {
      ...extraHeaders,
      Authorization: 'Zoho-oauthtoken ' + access,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const access = await token();
  let response = await send(access);
  if (response.status === 401 && method === 'GET') {
    await response.body?.cancel();
    response = await send(await token(access));
  }
  const data = await response.json();
  if (response.status === 401 && method !== 'GET') await token(access);
  return { response, data, operation };
}

function checked({ response, data, operation }, code) {
  if (!response.ok || data?.code !== code) {
    throw new ZohoError(operation, response.status, data?.code);
  }
  return data;
}

export function creator(prefix = 'Z_CREATOR') {
  const token = oauth(prefix);
  const base = httpsOrigin('Z_CREATOR_API') + '/creator/v2.1/data/' +
    ['Z_CREATOR_OWNER', 'Z_CREATOR_APP'].map(key => encodeURIComponent(required(key))).join('/');
  return {
    async read(report, fields, criteria, limit = 200) {
      const records = [];
      let cursor;
      const query = new URLSearchParams({ field_config: 'custom', fields, max_records: '200' });
      if (criteria) query.set('criteria', criteria);
      do {
        const result = await api(token, base + '/report/' + report + '?' + query, 'GET',
          'creator.read', undefined, cursor ? { record_cursor: cursor } : {});
        if (!cursor && ((result.response.ok && result.data?.code === 9220) ||
            (criteria && result.response.status === 400 && result.data?.code === 9280))) return [];
        const data = checked(result, 3000);
        if (!Array.isArray(data.data)) throw new ZohoError('creator.read', result.response.status);
        records.push(...data.data);
        cursor = result.response.headers.get('record_cursor');
        if (records.length > limit || (cursor && records.length >= limit)) {
          throw new ZohoError('creator.limit', result.response.status);
        }
      } while (cursor);
      return records;
    },
    async add(form, fields) {
      const result = await api(token, base + '/form/' + form, 'POST', 'creator.add', { data: fields });
      const data = checked(result, 3000);
      const row = Array.isArray(data.result) ? data.result[0] : data;
      if (row?.code !== 3000 || !isId(row.data?.ID)) {
        throw new ZohoError('creator.add', result.response.status, row?.code);
      }
      return row.data.ID;
    },
    async update(report, id, fields) {
      if (!isId(id)) throw new Error('Invalid Creator record ID');
      const result = await api(token, base + '/report/' + report, 'PATCH', 'creator.update',
        { criteria: 'ID == ' + id, data: fields });
      const data = checked(result, 3000);
      if (data.result?.length !== 1 || data.result[0].code !== 3000 || data.result[0].data?.ID !== id) {
        throw new ZohoError('creator.update', result.response.status);
      }
    },
  };
}

export function commerce() {
  const token = oauth('Z_SYNC');
  const base = httpsOrigin('Z_COMMERCE_API') + '/store/api/v1/products';
  const headers = { 'X-com-zoho-store-organizationid': required('Z_STORE_ORG') };
  return async (payload, id) => {
    if (id && !isId(id)) throw new Error('Invalid Commerce product ID');
    const result = await api(token, id ? base + '/' + id : base, id ? 'PUT' : 'POST',
      'commerce.product', payload, headers);
    const data = checked(result, 0);
    if (!id && !isId(data.product?.product_id)) throw new ZohoError('commerce.product', result.response.status);
    return id || data.product.product_id;
  };
}

export function publicProduct(row) {
  if (!nodePattern.test(row.Masked_Node_ID) ||
      !['Tablets', 'Capsules', 'Injectables'].includes(row.Dosage_Form) ||
      !['WHO-GMP', 'Schedule M'].includes(row.Certification) ||
      !Number.isSafeInteger(Number(row.MOQ)) || Number(row.MOQ) < 1) {
    throw new Error('Invalid public catalog fields');
  }
  return {
    node: row.Masked_Node_ID, dosage: row.Dosage_Form,
    certification: row.Certification, moq: Number(row.MOQ),
  };
}

