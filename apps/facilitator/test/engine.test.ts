import test from 'node:test';
import assert from 'node:assert/strict';
import { FacilitatorEngine } from '../src/engine';
import { UCAN, type SettlementRecord } from '../src/model';
import { fixture, FakeRail, MemoryStore } from './fixtures';

async function setup(mode: 'none' | 'both' = 'both') {
  const f = await fixture(mode), store = new MemoryStore(), rail = new FakeRail();
  await store.put(`offer:${f.offer.id}`, f.offer);
  const engine = new FacilitatorEngine(store, { OPERATOR_CONFIG_JSON: '' }, () => rail);
  return { ...f, store, rail, engine };
}
test('verify is read-only and never prepares or submits a payment', async () => {
  const f = await setup(), before = structuredClone(f.store.data);
  assert.equal((await f.engine.verify(f.request, f.tenant, f.config)).verification.isValid, true);
  assert.deepEqual(f.store.data, before);
  assert.equal(f.rail.prepares, 0);
  assert.equal(f.rail.submissions.length, 0);
});
test('direct settlement still rejects missing authority before the rail is called', async () => {
  const f = await setup(); delete f.request.paymentPayload.extensions![UCAN];
  await assert.rejects(f.engine.settle(f.request, f.tenant, f.config), /ucan_required/);
  assert.equal(f.rail.verifies, 0); assert.equal(f.rail.prepares, 0);
});
test('concurrent identical retries prepare and submit once and retain separate receipt', async () => {
  const f = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.engine.settle(f.request, f.tenant, f.config)));
  assert.ok(results.every(r => r.success));
  assert.equal(f.rail.prepares, 1); assert.equal(f.rail.submissions.length, 1);
  assert.equal((results[0]!.extensions!['org.udid.receipt@1'] as { replayed: boolean }).replayed, false);
  assert.equal((results[1]!.extensions!['org.udid.receipt@1'] as { replayed: boolean }).replayed, true);
  assert.equal(f.credential.credentialSubject.decision.outcome, 'approved');
  await assert.rejects(f.engine.verify(f.request, f.tenant, f.config), /already_consumed/);
});
test('a different payment nonce cannot spend the same offer/decision concurrently', async () => {
  const f = await setup(), second = structuredClone(f.request);
  (second.paymentPayload.payload.authorization as { nonce: string }).nonce = `0x${'c'.repeat(64)}`;
  const results = await Promise.allSettled([f.engine.settle(f.request, f.tenant, f.config), f.engine.settle(second, f.tenant, f.config)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.rail.submissions.length, 1);
});
test('pending recovery after a new engine instance uses persisted transaction without re-verification', async () => {
  const f = await setup(); f.rail.pending = true;
  const pending = await f.engine.settle(f.request, f.tenant, f.config);
  assert.equal(pending.errorReason, 'settlement_pending'); assert.ok(pending.transaction);
  f.rail.pending = false;
  const recovered = new FacilitatorEngine(f.store, { OPERATOR_CONFIG_JSON: '' }, () => f.rail, () => f.offer.expiresAt + 5000);
  assert.equal((await recovered.settle(f.request, f.tenant, f.config)).success, true);
  assert.equal(f.rail.prepares, 1); assert.equal(f.rail.verifies, 1);
  assert.deepEqual(f.rail.submissions[0], f.rail.submissions[1]);
});
test('crash after signing but before broadcast resumes the journaled transaction', async () => {
  const f = await setup();
  f.rail.submit = async () => { throw new Error('process_lost'); };
  await f.engine.settle(f.request, f.tenant, f.config);
  const newRail = new FakeRail();
  const recovered = new FacilitatorEngine(f.store, { OPERATOR_CONFIG_JSON: '' }, () => newRail);
  assert.equal((await recovered.settle(f.request, f.tenant, f.config)).success, true);
  assert.equal(newRail.prepares, 0); assert.equal(newRail.verifies, 0);
  assert.equal(newRail.submissions[0]!.rawTransaction, '0x1234');
});
test('changed payload, expired offer, unauthorized tenant and budget fail closed', async () => {
  const f = await setup('none');
  const changed = structuredClone(f.request); changed.paymentPayload.accepted.amount = '1';
  await assert.rejects(f.engine.settle(changed, f.tenant, f.config), /offer_mismatch/);
  await assert.rejects(f.engine.settle(f.request, { ...f.tenant, id: 'other' }, f.config), /offer_not_found/);
  f.tenant.rules[0]!.dailyBudget = '99999';
  await assert.rejects(f.engine.settle(f.request, f.tenant, f.config), /daily_budget_exceeded/);
  assert.equal(f.rail.prepares, 0);
  assert.ok(![...f.store.data.keys()].some(k => k.startsWith('consumed-offer:')));
  const expired = new FacilitatorEngine(f.store, { OPERATOR_CONFIG_JSON: '' }, () => f.rail, () => f.offer.expiresAt + 1);
  await assert.rejects(expired.verify(f.request, f.tenant, f.config), /offer_expired/);
});
test('failed signed transaction remains consumed and status never exposes raw transaction', async () => {
  const f = await setup();
  f.rail.submit = async prepared => ({ success: false, transaction: prepared.transaction, network: f.offer.requirements.network, errorReason: 'transaction_reverted' });
  const result = await f.engine.settle(f.request, f.tenant, f.config);
  assert.equal(result.errorReason, 'transaction_reverted');
  const record = [...f.store.data.values()].find((v): v is SettlementRecord => typeof v === 'object' && v !== null && 'state' in v);
  assert.ok(record);
  const status = await f.engine.status(record.id, f.tenant.id);
  assert.equal(status.state, 'failed'); assert.ok(!JSON.stringify(status).includes('0x1234'));
  await assert.rejects(f.engine.status(record.id, 'other'), /not_found/);
});
