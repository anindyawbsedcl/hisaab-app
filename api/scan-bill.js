const LLAMA_API_BASE = 'https://api.cloud.llamaindex.ai';
const MAX_BASE64_LENGTH = 4_000_000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 6;
const DEFAULT_PARSE_TIER = 'cost_effective';
const ALLOWED_PARSE_TIERS = new Set(['fast', 'cost_effective']);
const rateBuckets = new Map();

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

async function startParsing(request, response) {
  enforceRateLimit(request, response);
  const body = getRequestBody(request);
  const tier = String(body.tier || DEFAULT_PARSE_TIER).toLowerCase();
  if (!ALLOWED_PARSE_TIERS.has(tier)) {
    throw new ApiError(400, 'OCR tier must be fast or cost_effective.', 'INVALID_PARSE_TIER');
  }
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
  formData.append('purpose', 'parse');

  const uploadedFile = await llamaRequest(`/api/v1/beta/files${getProjectQuery()}`, {
    method: 'POST',
    body: formData
  });
  if (!uploadedFile.id) throw new ApiError(502, 'The OCR provider did not accept the image.', 'OCR_PROVIDER_ERROR');

  const parseConfiguration = {
    file_id: uploadedFile.id,
    tier,
    version: 'latest',
    input_options: {
      image: {
        camera_photo_correction: true
      }
    },
    page_ranges: { max_pages: 1 },
    disable_cache: true,
    client_name: 'hisaab-app'
  };

  if (tier === 'cost_effective') {
    parseConfiguration.agentic_options = {
      custom_prompt: 'This is an Indian restaurant receipt. Preserve the restaurant name and keep each purchased item on its own line with quantity, unit price, and line total. Preserve GST, subtotal, and final total labels.'
    };
  }

  const parseJob = await llamaRequest(`/api/v2/parse${getProjectQuery()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parseConfiguration)
  });

  if (!parseJob.id) throw new ApiError(502, 'The OCR parse job could not be started.', 'OCR_PROVIDER_ERROR');
  sendJson(response, 202, {
    jobId: parseJob.id,
    status: parseJob.status || 'PENDING',
    stage: 'PARSING',
    tier
  });
}

async function getParsing(request, response) {
  const requestUrl = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  const jobId = requestUrl.searchParams.get('jobId') || '';
  if (!/^pjb-[A-Za-z0-9-]{8,}$/.test(jobId)) {
    throw new ApiError(400, 'A valid parse job ID is required.', 'INVALID_JOB_ID');
  }

  const projectQuery = getProjectQuery();
  const separator = projectQuery ? '&' : '?';
  const result = await llamaRequest(
    `/api/v2/parse/${encodeURIComponent(jobId)}${projectQuery}${separator}expand=markdown_full&expand=text_full&expand=usage`
  );
  const job = result.job || result;
  const status = String(job.status || '').toUpperCase();
  const tier = String(job.tier || DEFAULT_PARSE_TIER).toLowerCase();

  if (status === 'COMPLETED') {
    const rawText = String(result.text_full || result.markdown_full || '').trim();
    sendJson(response, 200, {
      status,
      provider: tier === 'fast' ? 'LlamaParse Fast' : 'LlamaParse Cost Effective',
      tier,
      rawText,
      credits: job.usage?.credits ?? null
    });
    return;
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    throw new ApiError(502, job.error_message || 'The OCR parse failed.', 'OCR_PARSE_FAILED');
  }

  sendJson(response, 202, {
    jobId,
    status: status || 'PENDING',
    stage: 'PARSING',
    tier
  });
}

module.exports = async function handler(request, response) {
  try {
    if (!process.env.LLAMA_CLOUD_API_KEY) {
      throw new ApiError(503, 'Cloud OCR is not configured.', 'OCR_NOT_CONFIGURED');
    }

    if (request.method === 'POST') {
      await startParsing(request, response);
      return;
    }
    if (request.method === 'GET') {
      await getParsing(request, response);
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
  DEFAULT_PARSE_TIER,
  ALLOWED_PARSE_TIERS
};
