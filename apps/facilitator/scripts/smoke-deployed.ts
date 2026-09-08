import assert from 'node:assert/strict';
import { FacilitatorClient } from '../src/client';
import { UCAN, UDID, type PaymentRequest } from '../src/model';
import { createDemoPayment, loadDemo } from './demo-payment';

const origin = process.env.FACILITATOR_URL;
assert.ok(origin && origin.startsWith('https://'), 'Set FACILITATOR_URL to the HTTPS deployment you operate.');
const demo = await loadDemo(), checks: { check: string; result: string }[] = [];
async function read(path: string, options?: RequestInit) {
  return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(30_000) });
}
const health = await read('/health');
assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok', configured: true });
checks.push({ check: 'health', result: 'configured' });
const support = await (await read('/supported')).json() as { kinds: { network: string }[]; extensions: string[] };
assert.deepEqual(support.kinds.map(k => k.network), ['eip155:84532']);
assert.ok(support.extensions.includes(UCAN) && support.extensions.includes(UDID));
checks.push({ check: 'supported', result: 'Base Sepolia, UCAN and UDID' });
assert.equal((await read('/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
checks.push({ check: 'resource-server authentication', result: 'missing key rejected' });

const client = new FacilitatorClient(origin, demo.apiKey);
const { offer, payment } = await createDemoPayment(client, demo);
checks.push({ check: 'authenticated offer registration', result: 'created' });
const base: PaymentRequest = { x402Version: 2, offerId: offer.offerId, paymentRequirements: offer.paymentRequired.accepts[0]!, paymentPayload: payment };
async function rejection(name: string, mutate: (body: PaymentRequest) => void, expected: RegExp, endpoint = '/verify') {
  const body = structuredClone(base); mutate(body);
  const response = await read(endpoint, { method: 'POST', headers: { authorization: `Bearer ${demo.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const result = await response.json() as { isValid?: boolean; success?: boolean; invalidReason?: string; errorReason?: string };
  assert.ok(result.isValid === false || result.success === false);
  const code = result.invalidReason ?? result.errorReason ?? '';
  assert.match(code, expected); checks.push({ check: name, result: code });
}
await rejection('UCAN required', body => { delete body.paymentPayload.extensions![UCAN]; }, /^ucan_required$/);
await rejection('UDID required', body => { delete body.paymentPayload.extensions![UDID]; }, /^udid_required$/);
await rejection('offer amount binding', body => { body.paymentPayload.accepted.amount = '1'; }, /^offer_mismatch$/);
await rejection('payment signature', body => { body.paymentPayload.payload.signature = `0x${'a'.repeat(128)}1b`; }, /signature/);
await rejection('direct settlement cannot bypass authority', body => { delete body.paymentPayload.extensions![UCAN]; }, /^ucan_required$/, '/settle');
const verification = await client.verify(offer, payment);
assert.ok(verification.isValid || /insufficient_(funds|balance)/.test(verification.invalidReason ?? ''), JSON.stringify(verification));
checks.push({ check: 'signed UCAN + UDID + EIP-712 against live RPC', result: verification.isValid ? 'valid' : verification.invalidReason! });
console.log(JSON.stringify({ origin, checks, paymentSubmitted: false }, null, 2));
