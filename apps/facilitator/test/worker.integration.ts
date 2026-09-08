import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { encode } from '@ucans/core';
import { UCAN, UDID, type PaymentRequest } from '../src/model';
import { ucan } from '../src/proofs/ucan';
import { sha256, decodeHeader } from '../src/util';
import { fixture, apiKey } from './fixtures';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizationTypes } from '@x402/evm';
import type { Hex } from 'viem';

test('Cloudflare Worker: signed proofs, durable concurrent settlement, restart, auth and input limits', { timeout: 60_000 }, async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(), 'facilitator-worker-'));
  const r = { scheme: 'stripe-manual-capture' as const, network: 'stripe:test', asset: 'usd', amount: '100', payTo: 'acct_example', maxTimeoutSeconds: 120, extra: {} };
  f.tenant.rules = [{ scheme: r.scheme, network: r.network, asset: r.asset, payTo: r.payTo, maxAmount: '1000', dailyBudget: '10000' }];
  f.tenant.authority!.roots[0]!.payer = 'cus_example';
  f.config.stripe = { network: 'stripe:test', account: 'acct_example' }; f.config.evm = [];
  let metadata: Record<string, string> = {}, captures = 0, reads = 0;
  const options = {
    name: 'facilitator-test', modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { COORDINATOR: { className: 'FacilitatorCoordinator', useSQLite: true } },
    bindings: { OPERATOR_CONFIG_JSON: JSON.stringify(f.config), STRIPE_SECRET_KEY: 'sk_test_fixture' },
    outboundService: async (request: import('miniflare').Request) => {
      assert.equal(new URL(request.url).hostname, 'api.stripe.com');
      if (request.method === 'POST') { captures++; assert.equal(await request.text(), 'amount_to_capture=100'); }
      else reads++;
      return new (await import('miniflare')).Response(JSON.stringify({ id: 'pi_example', object: 'payment_intent', amount: 100,
        amount_capturable: captures ? 0 : 100, amount_received: captures ? 100 : 0, status: captures ? 'succeeded' : 'requires_capture',
        currency: 'usd', capture_method: 'manual', livemode: false, customer: 'cus_example', metadata }), { headers: { 'content-type': 'application/json' } });
    },
  };
  const runtimeOptions = () => ({ ...convertV4MiniflareOptions(options), resourcePersistencePath: directory });
  let mf = new Miniflare(runtimeOptions());
  async function post(path: string, body: unknown) {
    return mf.dispatchFetch(`http://localhost${path}`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }
  try {
    assert.equal((await mf.dispatchFetch('http://localhost/health')).status, 200);
    assert.equal((await mf.dispatchFetch('http://localhost/settle', { method: 'POST' })).status, 401);
    const response = await post('/offers', { resource: f.offer.resource, paymentRequirements: r });
    assert.equal(response.status, 201);
    const advertised = await response.json() as { offerId: string; expiresAt: string; paymentRequired: { extensions: Record<string, { capability: typeof f.offer.capability; bindingDigest: string }> } };
    const offerId = advertised.offerId, expiresAt = Date.parse(advertised.expiresAt), bindingDigest = advertised.paymentRequired.extensions[UDID]!.bindingDigest;
    metadata = { x402_offer_id: offerId, x402_binding_digest: bindingDigest, x402_resource: f.offer.resource.url };
    const token = encode(await ucan.build({ issuer: f.root, audience: f.service.did(), capabilities: [advertised.paymentRequired.extensions[UCAN]!.capability], expiration: Math.floor(expiresAt / 1000) }));
    f.credential.validUntil = new Date(Math.floor(expiresAt / 1000) * 1000).toISOString();
    f.credential.credentialSubject.decision.authorityReference = await sha256(token);
    f.credential.credentialSubject.decision.binding = { offerId, bindingDigest, resource: f.offer.resource.url, network: r.network, asset: r.asset, payTo: r.payTo, amount: r.amount };
    const request: PaymentRequest = { x402Version: 2, offerId, paymentRequirements: r,
      paymentPayload: { x402Version: 2, accepted: r, resource: f.offer.resource, payload: { paymentIntentId: 'pi_example', customerId: 'cus_example' } } };
    const missing = await (await post('/settle', request)).json() as { success: boolean; errorReason: string };
    assert.equal(missing.errorReason, 'ucan_required'); assert.equal(reads, 0); assert.equal(captures, 0);
    request.paymentPayload.extensions = { [UCAN]: { token }, [UDID]: { format: 'jwt_vc_json', presentation: await f.sign() } };
    const verified = await post('/verify', request);
    assert.deepEqual(await verified.json(), { isValid: true, payer: 'cus_example' });
    assert.equal((decodeHeader(verified.headers.get('EXTENSION-RESPONSES')!) as Record<string, { status: string }>)[UDID]!.status, 'verified');
    assert.equal(captures, 0);
    const results = await Promise.all(Array.from({ length: 5 }, async () => (await post('/settle', request)).json() as Promise<{ success: boolean; extensions: Record<string, { settlementId: string }> }>));
    assert.ok(results.every(result => result.success)); assert.equal(captures, 1);
    const id = results[0]!.extensions['org.udid.receipt@1']!.settlementId;
    await mf.dispose(); mf = new Miniflare(runtimeOptions());
    const retry = await (await post('/settle', request)).json() as { success: boolean };
    assert.equal(retry.success, true, JSON.stringify(retry)); assert.equal(captures, 1);
    const status = await mf.dispatchFetch(`http://localhost/settlements/${id}`, { headers: { authorization: `Bearer ${apiKey}` } });
    assert.equal((await status.json() as { state: string }).state, 'settled');
    assert.equal((await post('/verify', { bad: true })).status, 400);
    assert.equal((await post('/verify', { large: 'a'.repeat(70_000) })).status, 413);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('Cloudflare Worker verifies EVM typed data with the upstream x402 adapter', { timeout: 30_000 }, async () => {
  const f = await fixture('none');
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`);
  let rpcCalls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'evm-facilitator-test', modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { OPERATOR_CONFIG_JSON: JSON.stringify(f.config), EVM_PRIVATE_KEY: `0x${'2'.repeat(64)}` },
    durableObjects: { COORDINATOR: { className: 'FacilitatorCoordinator', useSQLite: true } },
    outboundService: async request => {
      const rpc = await request.json() as { id: number; method: string; params: unknown[] }; rpcCalls++;
      assert.ok(['eth_chainId', 'eth_getCode', 'eth_call'].includes(rpc.method), `Unexpected mutation or RPC: ${rpc.method}`);
      const result = rpc.method === 'eth_chainId' ? '0x14a34'
        : rpc.method === 'eth_getCode' && String(rpc.params[0]).toLowerCase() === f.offer.requirements.asset.toLowerCase() ? '0x01' : '0x';
      return new (await import('miniflare')).Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { headers: { 'content-type': 'application/json' } });
    },
  }));
  const post = (path: string, body: unknown) => mf.dispatchFetch(`http://localhost${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const offer = await (await post('/offers', { resource: f.offer.resource, paymentRequirements: f.offer.requirements })).json() as { offerId: string; expiresAt: string };
    const a = { from: account.address, to: f.offer.requirements.payTo as Hex, value: BigInt(f.offer.requirements.amount),
      validAfter: BigInt(Math.floor(Date.now() / 1000) - 10), validBefore: BigInt(Math.floor(Date.parse(offer.expiresAt) / 1000)), nonce: `0x${'a'.repeat(64)}` as Hex };
    const signature = await account.signTypedData({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: f.offer.requirements.asset as Hex },
      primaryType: 'TransferWithAuthorization', types: authorizationTypes, message: a });
    f.request.offerId = offer.offerId;
    f.request.paymentPayload.payload = { signature, authorization: { ...a, value: a.value.toString(), validAfter: a.validAfter.toString(), validBefore: a.validBefore.toString() } };
    const result = await (await post('/verify', f.request)).json();
    assert.deepEqual(result, { isValid: true, payer: account.address }); assert.ok(rpcCalls >= 3);
  } finally { await mf.dispose(); }
});
