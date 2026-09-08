import test from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '@ucans/core';
import { CompactSign, exportJWK, generateKeyPair } from 'jose';
import { UCAN, UDID } from '../src/model';
import { verifyProofs } from '../src/proofs';
import { ucan } from '../src/proofs/ucan';
import { canonical, sha256 } from '../src/util';
import { fixture, payer } from './fixtures';

for (const mode of ['none', 'ucan', 'udid', 'both'] as const) test(`independent ${mode} mode verifies real signatures`, async () => {
  const f = await fixture(mode);
  const result = await verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now());
  assert.equal(result.ucan, f.tenant.requireUcan ? 'verified' : 'not_requested');
  assert.equal(result.udid, f.tenant.requireUdid ? 'verified' : 'not_requested');
});

for (const field of ['offerId', 'bindingDigest', 'resource', 'network', 'asset', 'payTo', 'amount'] as const) test(`rejects signed decision with substituted ${field}`, async () => {
  const f = await fixture('udid');
  const binding = f.credential.credentialSubject.decision.binding;
  binding[field] = field === 'bindingDigest' ? `sha256:${'f'.repeat(64)}` : field === 'amount' ? '200000' : `${binding[field]}changed`;
  f.request.paymentPayload.extensions![UDID] = { format: 'jwt_vc_json', presentation: await f.sign() };
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now()));
});

for (const change of ['signature', 'issuer', 'type', 'expired', 'future', 'declined', 'policy', 'digest', 'revoked', 'status_missing', 'authority'] as const) test(`rejects UDID ${change}`, async () => {
  const f = await fixture();
  const d = f.credential.credentialSubject.decision;
  if (change === 'issuer') f.tenant.decision!.trustedIssuers = [];
  if (change === 'type') f.credential.type = ['VerifiableCredential'];
  if (change === 'expired') f.credential.validUntil = new Date(Date.now() - 5000).toISOString();
  if (change === 'future') f.credential.validFrom = new Date(Date.now() + 5000).toISOString();
  if (change === 'declined') d.outcome = 'declined';
  if (change === 'policy') d.policy.id = 'urn:other';
  if (change === 'digest') d.policy.digest = `sha256:${'c'.repeat(64)}`;
  if (change === 'revoked') f.tenant.decision!.revokedDecisionIds = [{ issuer: f.credential.issuer, id: d.id }];
  if (change === 'status_missing') f.tenant.decision!.requireStatus = true;
  if (change === 'authority') d.authorityReference = `sha256:${'c'.repeat(64)}`;
  let token = await f.sign();
  if (change === 'signature') { const parts = token.split('.'); parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`; token = parts.join('.'); }
  f.request.paymentPayload.extensions![UDID] = { format: 'jwt_vc_json', presentation: token };
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now()));
});

for (const change of ['absent', 'audience', 'expired', 'capability', 'untrusted_root', 'revoked_parent', 'broadened', 'signature'] as const) test(`rejects UCAN ${change}`, async () => {
  const f = await fixture('ucan');
  let token = f.token;
  if (change === 'audience' || change === 'expired' || change === 'capability' || change === 'broadened') {
    token = encode(await ucan.build({ issuer: f.agent,
      audience: change === 'audience' ? f.root.did() : f.service.did(),
      expiration: Math.floor(Date.now() / 1000) + (change === 'expired' ? -10 : 40),
      capabilities: change === 'broadened' ? [{ ...f.offer.capability, can: { namespace: 'payment', segments: ['*'] } }]
        : [{ ...f.offer.capability, with: change === 'capability' ? { scheme: 'x402', hierPart: 'other' } : f.offer.capability.with }],
      proofs: [f.delegation],
    }));
  }
  if (change === 'untrusted_root') f.tenant.authority!.roots[0]!.issuer = f.service.did();
  if (change === 'revoked_parent') f.tenant.authority!.revokedTokenDigests = [await sha256(f.delegation)];
  if (change === 'signature') { const parts = token.split('.'); parts[2] = 'A'.repeat(86); token = parts.join('.'); }
  f.request.paymentPayload.extensions![UCAN] = { token };
  if (change === 'absent') delete f.request.paymentPayload.extensions![UCAN];
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now()));
});

test('checks configured credential status and refuses revocation', async () => {
  const f = await fixture('udid');
  const vc = { ...f.credential, credentialStatus: { id: 'https://status.example.test/1', type: 'OperatorStatus' } };
  f.request.paymentPayload.extensions![UDID] = { format: 'jwt_vc_json', presentation: await f.sign(vc) };
  let active = true;
  const env = { OPERATOR_CONFIG_JSON: '', STATUS_CHECKER: { fetch: async () => Response.json({ active, checkedAt: Date.now(), issuer: vc.issuer, credentialId: vc.id, statusId: vc.credentialStatus.id }) } as unknown as Fetcher };
  assert.equal((await verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, env, Date.now())).udid, 'verified');
  active = false;
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, env, Date.now()), /revoked_or_suspended/);
});

test('holder presentation binds payer, audience, challenge and expiry', async () => {
  const f = await fixture('udid'), key = await generateKeyPair('EdDSA', { extractable: true });
  const did = 'did:web:holder.example.test';
  f.offer.holderBinding = 'did-authentication';
  f.tenant.decision!.holderBinding = 'did-authentication';
  f.tenant.decision!.holders = [{ payer, did }];
  f.tenant.decision!.keys.push({ kid: `${did}#auth`, controller: did, purpose: 'authentication', jwk: await exportJWK(key.publicKey) as { kty: 'OKP'; crv: 'Ed25519'; x: string } });
  const vp = { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiablePresentation'], holder: did,
    aud: f.offer.resource.url, nonce: f.offer.id, exp: Math.floor(f.offer.expiresAt / 1000), verifiableCredential: [await f.sign()] };
  async function sign() { return new CompactSign(new TextEncoder().encode(canonical(vp))).setProtectedHeader({ alg: 'EdDSA', typ: 'vp+jwt', kid: `${did}#auth` }).sign(key.privateKey); }
  f.request.paymentPayload.extensions![UDID] = { format: 'jwt_vp_json', presentation: await sign() };
  assert.equal((await verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now())).udid, 'verified');
  vp.nonce = 'other-offer';
  f.request.paymentPayload.extensions![UDID] = { format: 'jwt_vp_json', presentation: await sign() };
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now()), /holder_binding_mismatch/);
});

for (const change of ['extends_expiry', 'removes_nbf', 'wrong_parent_audience', 'future_nbf'] as const) test(`UCAN rejects delegation that ${change}`, async () => {
  const f = await fixture('ucan'), now = Math.floor(Date.now() / 1000);
  const delegation = encode(await ucan.build({ issuer: f.root, audience: change === 'wrong_parent_audience' ? f.service.did() : f.agent.did(),
    capabilities: [f.offer.capability], expiration: now + 30, notBefore: now - 20 }));
  const token = encode(await ucan.build({ issuer: f.agent, audience: f.service.did(), capabilities: [f.offer.capability],
    expiration: now + (change === 'extends_expiry' ? 40 : 20),
    ...(change === 'removes_nbf' ? {} : { notBefore: change === 'future_nbf' ? now + 10 : now - 10 }), proofs: [delegation] }));
  f.request.paymentPayload.extensions![UCAN] = { token };
  await assert.rejects(verifyProofs(f.request.paymentPayload, f.offer, f.tenant, payer, { OPERATOR_CONFIG_JSON: '' }, Date.now()));
});
