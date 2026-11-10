const LLAMA_API_BASE = 'https://api.cloud.llamaindex.ai';
const MAX_BASE64_LENGTH = 4_000_000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 6;
const rateBuckets = new Map();

const BILL_SCHEMA = {
  type: 'object',
  properties: {
    venue_name: {
      type: ['string', 'null'],
      description: 'Restaurant, cafe, hotel, or food outlet name printed in the receipt header. Do not return an address, TAX INVOICE, RESTAURANT BILL, or RECEIPT.'
    },
    items: {
      type: 'array',
      description: 'Every purchased food or drink line item. Exclude taxes, discounts, service charges, subtotal, round-off, tips, and totals.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Menu item name exactly as printed, without its quantity or price.'
          },
          quantity: {
            type: 'integer',
            description: 'Number of units purchased. Use 1 when no quantity is printed.'
          },
          unit_price: {
            type: 'number',
            description: 'Price of one unit in Indian rupees before GST. If only a line total is printed, divide it by quantity.'
          },
          line_total: {
            type: ['number', 'null'],
            description: 'Printed total for this item line before GST, or unit_price multiplied by quantity when not printed.'
          }
        },
        required: ['name', 'quantity', 'unit_price']
      }
    },
    subtotal: {
      type: ['number', 'null'],
      description: 'Receipt subtotal before tax, if printed.'
    },
    gst: {
      type: ['number', 'null'],
      description: 'Total GST amount including CGST and SGST, if printed.'
    },
    total: {
      type: ['number', 'null'],
      description: 'Final payable receipt total, if printed.'
    }
  },
  required: ['items']
};

class ApiError extends Error {
  constructor(status, message, code = 'SCAN_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function getRequestBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString());
  }
  return {};
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function enforceRateLimit(request, response) {
  const now = Date.now();
  const clientIp = getClientIp(request);
  const bucket = rateBuckets.get(clientIp);

  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(clientIp, { startedAt: now, count: 1 });
    return;
  }

  if (bucket.count >= RATE_LIMIT) {
    const retrySeconds = Math.ceil((RATE_WINDOW_MS - (now - bucket.startedAt)) / 1000);
    response.setHeader('Retry-After', String(retrySeconds));
    throw new ApiError(429, 'Too many bill scans. Please try again later.', 'RATE_LIMITED');
  }

  bucket.count += 1;
}

function getProjectQuery() {
  const projectId = process.env.LLAMA_CLOUD_PROJECT_ID?.trim();
  return projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
}

async function llamaRequest(path, options = {}) {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  const response = await fetch(`${LLAMA_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...options.headers
    }
  });
  const rawBody = await response.text();
  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = { message: rawBody };
  }

  if (!response.ok) {
    const upstreamMessage = payload.detail || payload.error_message || payload.message || 'LlamaCloud request failed.';
    throw new ApiError(502, upstreamMessage, 'OCR_PROVIDER_ERROR');
  }
  return payload;
}

function parseNumber(value) {
  const amount = Number(String(value ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function normalizeExtractedBill(extractResult) {
  const result = Array.isArray(extractResult) ? extractResult[0] || {} : extractResult || {};
  const extractedVenueName = String(result.venue_name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const venueName = /^(?:restaurant\s+bill|tax\s+invoice|invoice|receipt|bill)$/i.test(extractedVenueName)
    ? ''
    : extractedVenueName;
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const excludedRows = /\b(?:sub\s*total|grand\s*total|total|gst|cgst|sgst|igst|tax|discount|round(?:ing)?|service\s*charge|tip|amount\s*due|net\s*payable)\b/i;
  const items = rawItems.map((item) => {
    const name = String(item?.name || '').replace(/\s+/g, ' ').trim();
    const quantityValue = parseNumber(item?.quantity);
    const quantity = Number.isFinite(quantityValue) && quantityValue >= 1
      ? Math.max(1, Math.round(quantityValue))
      : 1;
    const extractedUnitPrice = parseNumber(item?.unit_price);
    const extractedLineTotal = parseNumber(item?.line_total);
    const unitPrice = extractedUnitPrice > 0
      ? extractedUnitPrice
      : extractedLineTotal > 0
        ? extractedLineTotal / quantity
        : 0;
    const lineTotal = extractedLineTotal > 0 ? extractedLineTotal : unitPrice * quantity;

    return {
      name,
      quantity,
      unitPrice: Math.round(unitPrice * 100) / 100,
      lineTotal: Math.round(lineTotal * 100) / 100
    };
  }).filter((item) => item.name && item.unitPrice > 0 && !excludedRows.test(item.name));

  return {
    venueName,
    items,
    totals: {
      subtotal: parseNumber(result.subtotal),
      gst: parseNumber(result.gst),
      total: parseNumber(result.total)
    }
  };
}

function createReadableText(bill) {
  const lines = bill.items.map(
    (item) => `${item.quantity} × ${item.name}  ${item.unitPrice.toFixed(2)}  ${item.lineTotal.toFixed(2)}`
  );
  if (bill.venueName) lines.unshift(`Venue: ${bill.venueName}`);
  if (bill.totals.subtotal !== null) lines.push(`Subtotal ${bill.totals.subtotal.toFixed(2)}`);
  if (bill.totals.gst !== null) lines.push(`GST ${bill.totals.gst.toFixed(2)}`);
  if (bill.totals.total !== null) lines.push(`Total ${bill.totals.total.toFixed(2)}`);
  return lines.join('\n');
}

async function startExtraction(request, response) {
  enforceRateLimit(request, response);
  const body = getRequestBody(request);
  const mimeType = String(body.mimeType || '').toLowerCase();
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowedTypes.has(mimeType)) {
    throw new ApiError(400, 'Upload a JPG, PNG, or WebP bill image.', 'INVALID_FILE_TYPE');
  }

  const base64 = String(body.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64 || base64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new ApiError(413, 'The prepared bill image is too large.', 'FILE_TOO_LARGE');
  }

  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 3_000_000) {
    throw new ApiError(413, 'The prepared bill image is too large.', 'FILE_TOO_LARGE');
  }

  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const formData = new FormData();
  formData.append('file', new Blob([bytes], { type: mimeType }), `bill.${extension}`);
  formData.append('purpose', 'extract');

  const uploadedFile = await llamaRequest('/api/v1/beta/files', {
    method: 'POST',
    body: formData
  });
  if (!uploadedFile.id) throw new ApiError(502, 'The OCR provider did not accept the image.', 'OCR_PROVIDER_ERROR');

  const requestedTier = process.env.LLAMA_EXTRACT_TIER || 'cost_effective';
  const tier = ['cost_effective', 'agentic', 'agentic_plus', 'turbo'].includes(requestedTier)
    ? requestedTier
    : 'cost_effective';
  const extraction = await llamaRequest(`/api/v2/extract${getProjectQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_input: uploadedFile.id,
      configuration: {
        tier,
        version: 'latest',
        max_pages: 1,
        disable_cache: true,
        cite_sources: false,
        confidence_scores: false,
        system_prompt: 'This is an Indian restaurant receipt. Identify the restaurant or food outlet name from the header. Extract only purchased food and drink rows. Do not treat subtotal, GST, CGST, SGST, discounts, service charge, tips, round-off, or final totals as menu items.',
        data_schema: BILL_SCHEMA
      }
    })
  });

  if (!extraction.id) throw new ApiError(502, 'The OCR extraction job could not be started.', 'OCR_PROVIDER_ERROR');
  sendJson(response, 202, { jobId: extraction.id, status: extraction.status || 'PENDING' });
}

async function getExtraction(request, response) {
  const requestUrl = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  const jobId = requestUrl.searchParams.get('jobId') || '';
  if (!/^ext-[A-Za-z0-9-]{8,}$/.test(jobId)) {
    throw new ApiError(400, 'A valid extraction job ID is required.', 'INVALID_JOB_ID');
  }

  const projectQuery = getProjectQuery();
  const separator = projectQuery ? '&' : '?';
  const job = await llamaRequest(
    `/api/v2/extract/${encodeURIComponent(jobId)}${projectQuery}${separator}expand=usage`
  );
  const status = String(job.status || '').toUpperCase();

  if (status === 'COMPLETED') {
    const bill = normalizeExtractedBill(job.extract_result);
    sendJson(response, 200, {
      status,
      provider: 'LlamaExtract',
      venueName: bill.venueName,
      items: bill.items,
      totals: bill.totals,
      rawText: createReadableText(bill),
      credits: job.usage?.credits ?? null
    });
    return;
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    throw new ApiError(502, job.error_message || 'The OCR extraction failed.', 'OCR_EXTRACTION_FAILED');
  }

  sendJson(response, 202, { jobId, status: status || 'PENDING' });
}

module.exports = async function handler(request, response) {
  try {
    if (!process.env.LLAMA_CLOUD_API_KEY) {
      throw new ApiError(503, 'Cloud OCR is not configured.', 'OCR_NOT_CONFIGURED');
    }

    if (request.method === 'POST') {
      await startExtraction(request, response);
      return;
    }
    if (request.method === 'GET') {
      await getExtraction(request, response);
      return;
    }

    response.setHeader('Allow', 'GET, POST');
    throw new ApiError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
    const status = error instanceof ApiError ? error.status : 500;
    const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof ApiError ? error.message : 'The bill could not be scanned.';
    sendJson(response, status, { error: message, code });
  }
};

module.exports._test = {
  BILL_SCHEMA,
  normalizeExtractedBill,
  createReadableText
};
