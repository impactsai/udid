import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function requireThat(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new AppError(code, status);
}
export function canonical(value: unknown): string { return canonicalize(value); }
export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}
export const hashObject = (value: unknown) => sha256(canonical(value));
export function encodeHeader(value: unknown): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
}
export function decodeHeader(value: string): unknown {
  requireThat(value.length <= 90_000, 'payload_too_large', 413);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
  } catch { throw new AppError('invalid_payment_encoding'); }
}
export async function readJson(request: Request): Promise<unknown> {
  requireThat(request.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json', 'expected_json', 415);
  const reader = request.body?.getReader();
  requireThat(reader, 'missing_body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65_536) { await reader.cancel(); throw new AppError('payload_too_large', 413); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer)); }
  catch { throw new AppError('invalid_json'); }
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}
export function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error instanceof z.ZodError) return 'invalid_request';
  return 'dependency_unavailable';
}
export function errorResponse(error: unknown): Response {
  return json({ error: errorCode(error) }, error instanceof AppError ? error.status : error instanceof z.ZodError ? 400 : 503);
}
