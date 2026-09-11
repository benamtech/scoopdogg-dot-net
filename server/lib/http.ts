import type { IncomingMessage, ServerResponse } from 'node:http';

export type ApiRequest = IncomingMessage & { body?: unknown };
export type ApiResponse = ServerResponse;

export function sendJson(res: ApiResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Reads a JSON body with a hard byte cap, so a huge POST cannot exhaust the function. */
export async function readJsonBody(req: ApiRequest, limitBytes = 256 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > limitBytes) throw new Error('Request body is too large.');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

/**
 * Never let a driver message, a stack, or a phone number reach a customer's screen.
 * The customer gets one reviewed sentence; the detail goes to the server log.
 */
export function safeError(scope: string, error: unknown) {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api:${scope}]`, { name, message: message.replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted-phone]').slice(0, 200) });
}
