import test from 'node:test';
import assert from 'node:assert/strict';
import { StripeRail } from '../src/rails/stripe';
import type { Payment } from '../src/model';
import { fixture } from './fixtures';

async function setup() {
  const f = await fixture('none');
  const r = { scheme: 'stripe-manual-capture' as const, network: 'stripe:test', amount: '100', asset: 'usd', payTo: 'acct_example', maxTimeoutSeconds: 60, extra: {} };
  const offer = { ...f.offer, requirements: r };
  const payment: Payment = { x402Version: 2, accepted: r, payload: { paymentIntentId: 'pi_example', customerId: 'cus_example' } };
  let intent = { id: 'pi_example', object: 'payment_intent', amount: 100, currency: 'usd', amount_capturable: 100, amount_received: 0,
    status: 'requires_capture', capture_method: 'manual', livemode: false, customer: 'cus_example',
    metadata: { x402_offer_id: offer.id, x402_binding_digest: offer.bindingDigest, x402_resource: offer.resource.url } };
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') intent = { ...intent, status: 'succeeded', amount_capturable: 0, amount_received: 100 };
    return Response.json(intent);
  }) as typeof fetch;
  const rail = new StripeRail({ network: 'stripe:test', account: 'acct_example' }, 'sk_test_example', fetcher);
  return { offer, payment, r, rail, calls, intent };
}
test('Stripe verification only reads; settlement captures the exact authorized amount with stable idempotency', async () => {
  const f = await setup();
  assert.equal((await f.rail.verify(f.payment, f.r, f.offer)).isValid, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.init!.method, 'GET');
  const prepared = await f.rail.prepare(f.payment);
  assert.equal((await f.rail.submit(prepared, f.r, 'cus_example')).success, true);
  const capture = f.calls.find(c => c.init?.method === 'POST')!;
  assert.equal((capture.init!.headers as Record<string, string>)['Stripe-Account'], 'acct_example');
  assert.match((capture.init!.headers as Record<string, string>)['Idempotency-Key']!, /^x402-[a-f0-9]{64}$/);
  assert.equal(String(capture.init!.body), 'amount_to_capture=100');
  assert.equal((await f.rail.submit(prepared, f.r, 'cus_example')).success, true);
  assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 1);
});
for (const change of ['merchant', 'amount', 'currency', 'offer', 'digest', 'resource', 'customer', 'environment', 'status'] as const) test(`Stripe rejects mismatched ${change}`, async () => {
  const f = await setup();
  if (change === 'merchant') f.r.payTo = 'acct_other';
  if (change === 'amount') f.intent.amount = 200;
  if (change === 'currency') f.intent.currency = 'eur';
  if (change === 'offer') f.intent.metadata.x402_offer_id = 'another';
  if (change === 'digest') f.intent.metadata.x402_binding_digest = 'another';
  if (change === 'resource') f.intent.metadata.x402_resource = 'another';
  if (change === 'customer') f.intent.customer = 'cus_other';
  if (change === 'environment') f.intent.livemode = true;
  if (change === 'status') f.intent.status = 'requires_action';
  await assert.rejects(f.rail.verify(f.payment, f.r, f.offer));
  assert.equal(f.calls.filter(c => c.init?.method === 'POST').length, 0);
});
test('Stripe ambiguous capture response returns pending, never false success', async () => {
  const f = await setup();
  const rail = new StripeRail({ network: 'stripe:test', account: 'acct_example' }, 'sk_test_example', (async () => { throw new Error('timeout'); }) as typeof fetch);
  const result = await rail.submit(await rail.prepare(f.payment), f.r, 'cus_example');
  assert.equal(result.errorReason, 'settlement_pending'); assert.equal(result.transaction, 'pi_example');
});
