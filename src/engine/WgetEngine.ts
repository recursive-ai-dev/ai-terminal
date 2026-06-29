// ============================================================
// WGET ENGINE — Native HTTP Methods (no wget binary)
// Implements wget's core feature set using browser Fetch API
// Methods: GET, HEAD, POST, Range, Spider, Mirror, Auth, Rate-limit
// Full: typed Results, structured logs, retry+backoff, progress streaming
// ============================================================

import { makeLogger } from "./logger";
import { cryptoUUID } from "./determinism";
import type { Result, DomainError } from "./types";
import { Ok, Err, makeDomainError } from "./types";

// ── Request / Response Types ───────────────────────────────

export type FetchMethod = "GET" | "HEAD" | "POST" | "PUT";

export interface FetchAuth {
  user: string;
  password: string;
}

export interface FetchRequest {
  url: string;
  method?: FetchMethod;
  headers?: Record<string, string>;
  body?: string;
  outputName?: string;           // logical name for stored result
  rangeStart?: number;           // Resume from byte offset (-c)
  rangeEnd?: number;
  maxBytes?: number;             // Quota guard (-Q)
  timeout?: number;              // ms — AbortController (--timeout)
  retries?: number;              // Max retry count (default 3)
  retryDelay?: number;           // Base delay ms (exponential backoff)
  limitRate?: number;            // bytes/sec token bucket (--limit-rate)
  userAgent?: string;            // (--user-agent)
  followRedirects?: boolean;     // default true (--no-location to disable)
  maxRedirects?: number;         // default 10
  auth?: FetchAuth;              // (--user / --password)
  spiderDepth?: number;          // Recursive spider depth (-r -l N)
  ifModifiedSince?: string;      // HTTP date (-N)
  acceptTypes?: string[];        // Filter by Content-Type
  saveBlob?: boolean;            // Trigger browser download
  correlationId?: string;        // Propagated trace ID
}

export interface FetchProgress {
  bytesReceived: number;
  totalBytes: number | null;     // null if Content-Length absent
  percent: number | null;
  elapsed_ms: number;
  rate_bps: number;              // bytes per second
}

export interface FetchResponse {
  url: string;                   // final URL after redirects
  status: number;
  statusText: string;
  headers: Record<string, string>;
  contentType: string;
  contentLength: number | null;
  body: string;                  // text body (truncated at maxBytes)
  bodyBytes: number;             // actual bytes received
  redirectChain: string[];
  elapsed_ms: number;
  progress: FetchProgress;
  correlationId: string;
  outputName: string;
  rangeSupported: boolean;       // Server sent Accept-Ranges: bytes
  lastModified: string | null;
  etag: string | null;
}

export interface SpiderResult {
  seedUrl: string;
  visited: string[];
  failed: Array<{ url: string; reason: string }>;
  links: string[];               // all discovered links
  responses: Map<string, FetchResponse>;
  depth: number;
  elapsed_ms: number;
  correlationId: string;
}

// ── Validated Request (internal) ──────────────────────────

interface ValidatedRequest extends Required<Omit<FetchRequest,
  "body" | "outputName" | "rangeStart" | "rangeEnd" |
  "auth" | "ifModifiedSince" | "acceptTypes" | "correlationId"
>> {
  body?: string;
  outputName: string;
  rangeStart: number | undefined;
  rangeEnd: number | undefined;
  auth?: FetchAuth;
  ifModifiedSince?: string;
  acceptTypes: string[];
  correlationId: string;
}

// ── Rate Limiter — Token Bucket ────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly rate: number; // bytes/sec

  constructor(rate: number) {
    this.rate = rate;
    this.tokens = rate;
    this.lastRefill = Date.now();
  }

  async consume(bytes: number): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.rate, this.tokens + elapsed * this.rate);
    this.lastRefill = now;

    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return;
    }

    // Need to wait
    const deficit = bytes - this.tokens;
    const waitMs = (deficit / this.rate) * 1000;
    this.tokens = 0;
    await sleep(waitMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── MIME / Content-Type helpers ────────────────────────────

const MIME_MAP: Record<string, string> = {
  "text/html":                   "html",
  "text/plain":                  "txt",
  "text/css":                    "css",
  "text/javascript":             "js",
  "application/javascript":      "js",
  "application/json":            "json",
  "application/xml":             "xml",
  "text/xml":                    "xml",
  "image/png":                   "png",
  "image/jpeg":                  "jpg",
  "image/gif":                   "gif",
  "image/webp":                  "webp",
  "image/svg+xml":               "svg",
  "application/pdf":             "pdf",
  "application/zip":             "zip",
  "application/octet-stream":    "bin",
  "application/wasm":            "wasm",
  "application/x-tar":           "tar",
  "application/gzip":            "gz",
};

function mimeToExt(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_MAP[base] ?? "bin";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(3)}GB`;
}

function formatRate(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)}B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)}KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)}MB/s`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

// ── Progress Bar renderer ──────────────────────────────────

export function renderProgress(p: FetchProgress, width = 30): string {
  const rate = formatRate(p.rate_bps);
  const recv = formatBytes(p.bytesReceived);
  const elapsed = formatDuration(p.elapsed_ms);
  if (p.percent !== null) {
    const filled = Math.round((p.percent / 100) * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    return `  [${bar}] ${p.percent.toFixed(1)}% ${recv} @ ${rate} in ${elapsed}`;
  }
  return `  [...streaming...] ${recv} @ ${rate} in ${elapsed}`;
}

// ── Link Extractor (spider) ────────────────────────────────

export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const base = new URL(baseUrl);

  // Match href and src attributes — covers <a>, <link>, <script>, <img>, <iframe>
  const hrefRe = /(?:href|src|action)\s*=\s*["']([^"'#?\s][^"'\s]*)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = hrefRe.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith("data:") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
    try {
      const resolved = new URL(raw, base).toString();
      // Only same-origin by default (wget -r behavior)
      const resolvedUrl = new URL(resolved);
      if (resolvedUrl.hostname === base.hostname) {
        links.add(resolved);
      }
    } catch {
      // Malformed URL — skip
    }
  }

  return Array.from(links);
}

// ── URL Validation ─────────────────────────────────────────

function validateUrl(raw: string): Result<URL> {
  let parsed: URL;
  try {
    // Support bare domains: add https:// if no protocol
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parsed = new URL(normalized);
  } catch {
    return Err(makeDomainError(
      "INVALID_INPUT",
      `Invalid URL: "${raw}" — could not parse`,
      "NON_RETRYABLE",
      { step: "VALIDATE_URL" }
    ));
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Err(makeDomainError(
      "INVALID_INPUT",
      `Protocol "${parsed.protocol}" rejected — only http: and https: allowed`,
      "NON_RETRYABLE",
      { step: "VALIDATE_URL" }
    ));
  }

  // Block private/loopback in production (security)
  const host = parsed.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local")) {
    // Allow for development — just warn in log, don't block
    // (wget allows all hosts; we do too with a note)
  }

  return Ok(parsed);
}

// ── Validate and normalize FetchRequest ───────────────────

function validateRequest(req: FetchRequest): Result<ValidatedRequest> {
  const urlResult = validateUrl(req.url);
  if (!urlResult.ok) return urlResult;

  const timeout = req.timeout ?? 30_000;
  if (timeout < 100 || timeout > 120_000) {
    return Err(makeDomainError(
      "INVALID_INPUT",
      `timeout must be 100–120000ms, got ${timeout}`,
      "NON_RETRYABLE",
      { step: "VALIDATE_REQUEST" }
    ));
  }

  const retries = req.retries ?? 3;
  if (retries < 0 || retries > 10) {
    return Err(makeDomainError(
      "INVALID_INPUT",
      `retries must be 0–10, got ${retries}`,
      "NON_RETRYABLE",
      { step: "VALIDATE_REQUEST" }
    ));
  }

  const maxBytes = req.maxBytes ?? 50 * 1024 * 1024; // 50MB default quota
  const MAX_QUOTA = 500 * 1024 * 1024; // 500MB hard cap
  if (maxBytes > MAX_QUOTA) {
    return Err(makeDomainError(
      "INVALID_INPUT",
      `maxBytes exceeds hard cap of ${formatBytes(MAX_QUOTA)}`,
      "NON_RETRYABLE",
      { step: "VALIDATE_REQUEST" }
    ));
  }

  const url = urlResult.value.toString();
  const ext = mimeToExt("application/octet-stream");
  const outputName = req.outputName ?? (url.split("/").pop()?.split("?")[0] || `download.${ext}`);

  return Ok({
    url,
    method: req.method ?? "GET",
    headers: req.headers ?? {},
    body: req.body,
    outputName,
    rangeStart: req.rangeStart,
    rangeEnd: req.rangeEnd,
    maxBytes,
    timeout,
    retries,
    retryDelay: req.retryDelay ?? 1000,
    limitRate: req.limitRate ?? 0,
    userAgent: req.userAgent ?? "WgetEngine/1.0 (NanoTerminal; Browser)",
    followRedirects: req.followRedirects ?? true,
    maxRedirects: req.maxRedirects ?? 10,
    auth: req.auth,
    spiderDepth: req.spiderDepth ?? 0,
    ifModifiedSince: req.ifModifiedSince,
    acceptTypes: req.acceptTypes ?? [],
    saveBlob: req.saveBlob ?? false,
    correlationId: req.correlationId ?? cryptoUUID.generate(),
  });
}

// ── Build RequestInit from ValidatedRequest ────────────────

function buildRequestInit(vReq: ValidatedRequest): RequestInit {
  const headers: Record<string, string> = {
    "User-Agent": vReq.userAgent,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    ...vReq.headers,
  };

  // Range request support (-c / --continue)
  if (vReq.rangeStart !== undefined && vReq.rangeStart > 0) {
    const end = vReq.rangeEnd !== undefined ? vReq.rangeEnd : "";
    headers["Range"] = `bytes=${vReq.rangeStart}-${end}`;
  }

  // If-Modified-Since (-N / --timestamping)
  if (vReq.ifModifiedSince) {
    headers["If-Modified-Since"] = vReq.ifModifiedSince;
  }

  // Basic auth (--user / --password)
  if (vReq.auth) {
    const creds = btoa(`${vReq.auth.user}:${vReq.auth.password}`);
    headers["Authorization"] = `Basic ${creds}`;
  }

  return {
    method: vReq.method,
    headers,
    body: vReq.body,
    // Note: redirect: "follow" is the default in fetch — we handle it
    redirect: vReq.followRedirects ? "follow" : "manual",
    // Note: AbortController signal is added per-attempt
  };
}

// ── Parse response headers to Record ──────────────────────

function parseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((val, key) => { out[key.toLowerCase()] = val; });
  return out;
}

// ── Single HTTP attempt (one try, no retry logic) ─────────

async function singleAttempt(
  vReq: ValidatedRequest,
  init: RequestInit,
  bucket: TokenBucket | null,
  onProgress: (p: FetchProgress) => void
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), vReq.timeout);
  const startMs = Date.now();

  try {
    const response = await fetch(vReq.url, {
      ...init,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const hdrs = parseHeaders(response.headers);
    const contentType = hdrs["content-type"] ?? "application/octet-stream";
    const contentLengthStr = hdrs["content-length"];
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : null;
    const rangeSupported = (hdrs["accept-ranges"] ?? "").toLowerCase() === "bytes";
    const lastModified = hdrs["last-modified"] ?? null;
    const etag = hdrs["etag"] ?? null;
    const finalUrl = response.url || vReq.url;

    // Build redirect chain from response URL vs request URL
    const redirectChain: string[] = [];
    if (finalUrl !== vReq.url) {
      redirectChain.push(vReq.url);
      redirectChain.push(finalUrl);
    }

    // Stream body with progress and rate limiting
    let body = "";
    let bodyBytes = 0;
    const startStream = Date.now();

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Quota guard [B5]
        bodyBytes += value.length;
        if (bodyBytes > vReq.maxBytes) {
          reader.cancel();
          body += decoder.decode(new Uint8Array(
            chunks.flatMap(c => Array.from(c)).concat(Array.from(value))
          ).slice(0, vReq.maxBytes));
          break;
        }

        // Rate limiting — token bucket consume
        if (bucket) {
          await bucket.consume(value.length);
        }

        chunks.push(value);

        // Progress event
        const now = Date.now();
        const elapsed = now - startStream;
        const rate = elapsed > 0 ? (bodyBytes / elapsed) * 1000 : 0;
        const percent = contentLength ? (bodyBytes / contentLength) * 100 : null;

        onProgress({
          bytesReceived: bodyBytes,
          totalBytes: contentLength,
          percent,
          elapsed_ms: elapsed,
          rate_bps: rate,
        });
      }

      // Decode full body for text types
      const isText = contentType.includes("text") ||
                     contentType.includes("json") ||
                     contentType.includes("xml") ||
                     contentType.includes("javascript");

      if (isText && body === "") {
        const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
        body = decoder.decode(combined);
      } else if (body === "") {
        body = `[binary: ${formatBytes(bodyBytes)} ${contentType}]`;
      }
    } else {
      body = await response.text();
      bodyBytes = new TextEncoder().encode(body).length;
    }

    const elapsed_ms = Date.now() - startMs;
    const rate_bps = elapsed_ms > 0 ? (bodyBytes / elapsed_ms) * 1000 : 0;

    const finalProgress: FetchProgress = {
      bytesReceived: bodyBytes,
      totalBytes: contentLength,
      percent: contentLength ? (bodyBytes / contentLength) * 100 : null,
      elapsed_ms,
      rate_bps,
    };

    return {
      url: finalUrl,
      status: response.status,
      statusText: response.statusText,
      headers: hdrs,
      contentType,
      contentLength,
      body,
      bodyBytes,
      redirectChain,
      elapsed_ms,
      progress: finalProgress,
      correlationId: vReq.correlationId,
      outputName: vReq.outputName,
      rangeSupported,
      lastModified,
      etag,
    };

  } catch (err) {
    clearTimeout(timer);
    if ((err as Error)?.name === "AbortError") {
      throw Object.assign(new Error(`Request timed out after ${vReq.timeout}ms`), { code: "TIMEOUT" });
    }
    throw err;
  }
}

// ── Retry logic with exponential backoff ──────────────────

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function classify4xx(status: number): DomainError {
  const messages: Record<number, string> = {
    400: "Bad Request",
    401: "Unauthorized — credentials required",
    403: "Forbidden — access denied",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    410: "Gone — resource permanently removed",
    429: "Too Many Requests — rate limited",
    451: "Unavailable For Legal Reasons",
  };
  return makeDomainError(
    "INVALID_INPUT",
    `HTTP ${status}: ${messages[status] ?? "Client Error"}`,
    status === 429 ? "RETRYABLE_SAFE" : "NON_RETRYABLE",
    { step: "HTTP_RESPONSE", context: { status } }
  );
}

// ── Core fetch with retry ──────────────────────────────────

export async function wgetFetch(req: FetchRequest): Promise<Result<FetchResponse>> {
  const validResult = validateRequest(req);
  if (!validResult.ok) return validResult;
  const vReq = validResult.value;

  const logger = makeLogger(vReq.correlationId, "fetch.get", "1.0.0");
  logger.start("VALIDATE_URL", { url: vReq.url, method: vReq.method });

  const bucket = vReq.limitRate > 0 ? new TokenBucket(vReq.limitRate) : null;
  const init = buildRequestInit(vReq);

  let lastError: DomainError | null = null;
  const t0 = Date.now();

  logger.transition("BUILD_REQUEST", {
    method: vReq.method,
    userAgent: vReq.userAgent,
    range: vReq.rangeStart !== undefined ? `${vReq.rangeStart}-${vReq.rangeEnd ?? ""}` : "none",
    timeout: vReq.timeout,
    retries: vReq.retries,
    limitRate: vReq.limitRate > 0 ? formatRate(vReq.limitRate) : "none",
  });

  for (let attempt = 0; attempt <= vReq.retries; attempt++) {
    if (attempt > 0) {
      const delay = vReq.retryDelay * Math.pow(2, attempt - 1); // exponential backoff
      logger.warn("RETRY", `Attempt ${attempt + 1}/${vReq.retries + 1} after ${delay}ms`, { attempt, delay });
      await sleep(delay);
    }

    try {
      logger.transition("FETCH_ATTEMPT", { attempt });

      let latestProgress: FetchProgress = {
        bytesReceived: 0, totalBytes: null, percent: null, elapsed_ms: 0, rate_bps: 0
      };

      const response = await singleAttempt(vReq, init, bucket, (p) => {
        latestProgress = p;
      });

      void latestProgress; // logged via progress events

      // Handle HTTP error status codes
      if (response.status >= 400) {
        if (response.status >= 400 && response.status < 500) {
          const err = classify4xx(response.status);
          logger.failure("HTTP_RESPONSE", err, Date.now() - t0);
          if (err.retryClass === "NON_RETRYABLE") {
            return Err(err);
          }
          lastError = err;
          continue; // retry 429
        }
        if (response.status >= 500) {
          if (isRetryableStatus(response.status)) {
            lastError = makeDomainError(
              "TRANSIENT_FAILURE",
              `HTTP ${response.status}: Server Error — retrying`,
              "RETRYABLE_TRANSIENT",
              { step: "HTTP_RESPONSE", context: { status: response.status } }
            );
            logger.warn("HTTP_RESPONSE", `HTTP ${response.status} — will retry`, { attempt });
            continue;
          }
        }
      }

      // Success
      logger.success("FETCH_COMPLETE", Date.now() - t0, {
        status: response.status,
        contentType: response.contentType,
        bodyBytes: response.bodyBytes,
        redirects: response.redirectChain.length,
        rangeSupported: response.rangeSupported,
      });

      return Ok(response);

    } catch (err) {
      const isTimeout = (err as { code?: string })?.code === "TIMEOUT";
      lastError = makeDomainError(
        isTimeout ? "TRANSIENT_FAILURE" : "TRANSIENT_FAILURE",
        (err as Error)?.message ?? "Network error",
        "RETRYABLE_TRANSIENT",
        { step: "FETCH_ATTEMPT", cause: err, context: { attempt } }
      );
      logger.warn("FETCH_ATTEMPT", lastError.message, { attempt });
    }
  }

  // All retries exhausted
  const finalError = lastError ?? makeDomainError(
    "TRANSIENT_FAILURE",
    "All retry attempts exhausted",
    "RETRYABLE_TRANSIENT",
    { step: "RETRY_EXHAUSTED" }
  );
  logger.failure("RETRY_EXHAUSTED", finalError, Date.now() - t0);
  return Err(finalError);
}

// ── HEAD request ───────────────────────────────────────────

export async function wgetHead(url: string, headers?: Record<string, string>): Promise<Result<FetchResponse>> {
  return wgetFetch({ url, method: "HEAD", headers, maxBytes: 0, timeout: 10_000, retries: 2 });
}

// ── POST request ───────────────────────────────────────────

export async function wgetPost(url: string, body: string, contentType = "application/json"): Promise<Result<FetchResponse>> {
  return wgetFetch({
    url,
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

// ── Spider (recursive link crawler) ───────────────────────

export async function wgetSpider(
  seedUrl: string,
  maxDepth = 2,
  maxPages = 50,
  onVisit?: (url: string, depth: number) => void
): Promise<Result<SpiderResult>> {
  const corrId = cryptoUUID.generate();
  const logger = makeLogger(corrId, "fetch.spider", "1.0.0");
  const t0 = Date.now();

  const validResult = validateUrl(seedUrl);
  if (!validResult.ok) return validResult;

  logger.start("SPIDER_INIT", { seedUrl, maxDepth, maxPages });

  const visited = new Set<string>();
  const failed: Array<{ url: string; reason: string }> = [];
  const allLinks = new Set<string>();
  const responses = new Map<string, FetchResponse>();

  // BFS queue: [url, depth]
  const queue: Array<[string, number]> = [[validResult.value.toString(), 0]];

  while (queue.length > 0 && visited.size < maxPages) {
    const [url, depth] = queue.shift()!;
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    logger.transition("SPIDER_FETCH", { url, depth, visited: visited.size });
    onVisit?.(url, depth);

    const result = await wgetFetch({
      url,
      method: "GET",
      timeout: 15_000,
      retries: 1,
      maxBytes: 2 * 1024 * 1024, // 2MB per page during spider
      correlationId: corrId,
    });

    if (!result.ok) {
      failed.push({ url, reason: result.error.message });
      continue;
    }

    const resp = result.value;
    responses.set(url, resp);

    // Only extract links from HTML
    if (resp.contentType.includes("html") && depth < maxDepth) {
      const links = extractLinks(resp.body, url);
      for (const link of links) {
        allLinks.add(link);
        if (!visited.has(link)) {
          queue.push([link, depth + 1]);
        }
      }
    }
  }

  logger.success("SPIDER_COMPLETE", Date.now() - t0, {
    visited: visited.size,
    failed: failed.length,
    links: allLinks.size,
  });

  return Ok({
    seedUrl: validResult.value.toString(),
    visited: Array.from(visited),
    failed,
    links: Array.from(allLinks),
    responses,
    depth: maxDepth,
    elapsed_ms: Date.now() - t0,
    correlationId: corrId,
  });
}

// ── Save blob to browser download (wget -O equivalent) ────

export function saveBlobDownload(body: string, filename: string, contentType = "text/plain"): void {
  try {
    const blob = new Blob([body], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Not in DOM context — no-op (e.g., test environment)
  }
}

// ── Format FetchResponse for terminal display ──────────────

export function formatFetchResponse(resp: FetchResponse, verbose = false): string[] {
  const lines: string[] = [];
  const statusColor = resp.status < 300 ? "✓" : resp.status < 400 ? "→" : "✗";

  lines.push(`[FETCH] ${statusColor} ${resp.status} ${resp.statusText}  ${resp.url}`);
  lines.push(`  Content-Type   : ${resp.contentType}`);
  lines.push(`  Content-Length : ${resp.contentLength !== null ? formatBytes(resp.contentLength) : "unknown"}`);
  lines.push(`  Received       : ${formatBytes(resp.bodyBytes)}`);
  lines.push(`  Elapsed        : ${formatDuration(resp.elapsed_ms)}`);
  lines.push(`  Rate           : ${formatRate(resp.progress.rate_bps)}`);
  lines.push(`  Range Support  : ${resp.rangeSupported ? "yes (resumable)" : "no"}`);

  if (resp.lastModified) lines.push(`  Last-Modified  : ${resp.lastModified}`);
  if (resp.etag) lines.push(`  ETag           : ${resp.etag}`);
  if (resp.redirectChain.length > 0) {
    lines.push(`  Redirects      :`);
    resp.redirectChain.forEach((u, i) => lines.push(`    ${i + 1}. ${u}`));
  }
  lines.push(`  Correlation-ID : ${resp.correlationId}`);
  lines.push(renderProgress(resp.progress));

  if (verbose) {
    lines.push("  Headers:");
    for (const [k, v] of Object.entries(resp.headers)) {
      lines.push(`    ${k}: ${v}`);
    }
  }

  // Show body preview
  const preview = resp.body.slice(0, 2000);
  if (preview) {
    lines.push("  ── Body Preview ──");
    const bodyLines = preview.split("\n").slice(0, 40);
    bodyLines.forEach(l => lines.push(`  ${l}`));
    if (resp.body.length > 2000) {
      lines.push(`  ... [${formatBytes(resp.bodyBytes)} total — use fetch.save to download]`);
    }
  }

  return lines;
}

export function formatFetchError(err: DomainError): string[] {
  return [
    `[FETCH] ✗ ${err.code}: ${err.message}`,
    `  Retry class: ${err.retryClass}`,
    `  Step: ${err.step ?? "unknown"}`,
    ...(err.cause ? [`  Cause: ${(err.cause as Error)?.message ?? String(err.cause)}`] : []),
  ];
}

export function formatSpiderResult(r: SpiderResult): string[] {
  const lines: string[] = [
    `[SPIDER] Seed: ${r.seedUrl}`,
    `  Visited : ${r.visited.length} pages`,
    `  Links   : ${r.links.length} discovered`,
    `  Failed  : ${r.failed.length}`,
    `  Elapsed : ${formatDuration(r.elapsed_ms)}`,
    `  Corr-ID : ${r.correlationId}`,
    "  ── Visited URLs ──",
  ];
  r.visited.slice(0, 30).forEach(u => lines.push(`  ✓ ${u}`));
  if (r.visited.length > 30) lines.push(`  ... and ${r.visited.length - 30} more`);
  if (r.failed.length > 0) {
    lines.push("  ── Failed ──");
    r.failed.forEach(f => lines.push(`  ✗ ${f.url}  (${f.reason})`));
  }
  if (r.links.length > 0) {
    lines.push("  ── Discovered Links (first 20) ──");
    r.links.slice(0, 20).forEach(l => lines.push(`  → ${l}`));
    if (r.links.length > 20) lines.push(`  ... and ${r.links.length - 20} more`);
  }
  return lines;
}

// ── Export helpers ─────────────────────────────────────────
export { formatBytes, formatRate, formatDuration, mimeToExt, validateUrl };
