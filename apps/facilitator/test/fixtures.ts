import { generateKeyPair, exportJWK, CompactSign } from 'jose';
import { encode } from '@ucans/core';
import { configSchema } from '../src/config';
import { UCAN, UDID, type PaymentRequest, type PreparedPayment, type RailAdapter, type SettlementResult, type Store } from '../src/model';
import { createOffer } from '../src/offers';
import { createAuthorityKey, ucan } from '../src/proofs/ucan';
import { canonical, hashObject, sha256 } from '../src/util';

export const payer = '0x857b06519E91e3A54538791bDbb0E22373e36b66';
export const requirements = { scheme: 'exact' as const, network: 'eip155:84532', amount: '100000',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } };
export const apiKey = 'test-resource-server-key-32-characters-long';

export async function fixture(mode: 'none' | 'ucan' | 'udid' | 'both' = 'both') {
  const root = await createAuthorityKey(), agent = await createAuthorityKey(), service = await createAuthorityKey();
  const issuerKey = await generateKeyPair('EdDSA', { extractable: true });
  const issuer = 'did:web:evaluator.example.test';
  const config = configSchema.parse({ tenants: [{
    id: 'merchant', apiKeyHash: await sha256(apiKey),
    requireUcan: ['ucan', 'both'].includes(mode), requireUdid: ['udid', 'both'].includes(mode),
    requestsPerMinute: 1000,
    rules: [{ ...requirements, maxAmount: '1000000', dailyBudget: '10000000', amount: undefined, maxTimeoutSeconds: undefined, extra: undefined }].map(({ amount, maxTimeoutSeconds, extra, ...r }) => r),
    authority: { audience: service.did(), roots: [{ payer, issuer: root.did() }] },
    decision: { keys: [{ kid: `${issuer}#key-1`, controller: issuer, purpose: 'assertionMethod', jwk: await exportJWK(issuerKey.publicKey) }],
      trustedIssuers: [issuer], policies: [{ id: 'urn:policy:example', version: '1', bytes: 'allow approved example payments' }] },
  }], evm: [{ network: requirements.network, rpcUrl: 'https://rpc.example.test', assets: [{ address: requirements.asset, name: 'USDC', version: '2' }] }] });
  const tenant = config.tenants[0]!;
  const offer = await createOffer({ resource: { url: 'https://api.example.test/weather' }, paymentRequirements: requirements }, tenant, Date.now());
  const request: PaymentRequest = { x402Version: 2, offerId: offer.id, paymentRequirements: offer.requirements,
    paymentPayload: { x402Version: 2, accepted: offer.requirements, resource: offer.resource,
      payload: { signature: `0x${'1'.repeat(130)}`, authorization: { from: payer, to: requirements.payTo, value: requirements.amount,
        validAfter: String(Math.floor(Date.now() / 1000) - 10), validBefore: String(Math.floor(offer.expiresAt / 1000)), nonce: `0x${'a'.repeat(64)}` } }, extensions: {} } };
  const expiration = Math.floor(offer.expiresAt / 1000);
  const delegation = encode(await ucan.build({ issuer: root, audience: agent.did(), capabilities: [offer.capability], expiration, notBefore: Math.floor(Date.now() / 1000) - 30 }));
  const token = encode(await ucan.build({ issuer: agent, audience: service.did(), capabilities: [offer.capability], expiration, notBefore: Math.floor(Date.now() / 1000) - 10, proofs: [delegation] }));
  if (tenant.requireUcan) request.paymentPayload.extensions![UCAN] = { token };
  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2'], id: `urn:uuid:${crypto.randomUUID()}`,
    type: ['VerifiableCredential', 'DecisionCredential', 'DecisionToPayCredential'], issuer,
    validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(expiration * 1000).toISOString(),
    credentialSubject: { id: 'urn:example:request', decision: {
      id: `urn:uuid:${crypto.randomUUID()}`, type: 'decision_to_pay', outcome: 'approved', evaluatedAt: new Date().toISOString(),
      policy: { id: 'urn:policy:example', version: '1', digest: await sha256(tenant.decision!.policies[0]!.bytes) },
      ...(tenant.requireUcan ? { authorityReference: await sha256(token) } : {}),
      binding: { offerId: offer.id, bindingDigest: offer.bindingDigest, resource: offer.resource.url, network: requirements.network,
        asset: requirements.asset, payTo: requirements.payTo, amount: requirements.amount },
    } },
  };
  async function sign(document: unknown = credential) {
    return new CompactSign(new TextEncoder().encode(canonical(document))).setProtectedHeader({ alg: 'EdDSA', typ: 'vc+jwt', kid: `${issuer}#key-1` }).sign(issuerKey.privateKey);
  }
  if (tenant.requireUdid) request.paymentPayload.extensions![UDID] = { format: 'jwt_vc_json', presentation: await sign() };
  return { config, tenant, offer, request, root, agent, service, token, delegation, credential, issuerKey, sign };
}

export class MemoryStore implements Store {
  data = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.data.set(key, structuredClone(value)); }
  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const snapshot = structuredClone(this.data);
      try { return await fn(this); } catch (error) { this.data = snapshot; throw error; }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
export class FakeRail implements RailAdapter {
  verifies = 0; prepares = 0; submissions: PreparedPayment[] = []; valid = true;
  pending = false;
  payer() { return payer; }
  async paymentKey(payment: PaymentRequest['paymentPayload']) {
    const authorization = payment.payload.authorization as { nonce: string };
    return hashObject([payment.accepted.network, authorization.nonce]);
  }
  async verify() { this.verifies++; return { isValid: this.valid, payer, invalidReason: this.valid ? undefined : 'invalid_signature' }; }
  async prepare(): Promise<PreparedPayment> { this.prepares++; return { transaction: `0x${'b'.repeat(64)}`, rawTransaction: '0x1234', nonce: this.prepares - 1 }; }
  async submit(prepared: PreparedPayment): Promise<SettlementResult> {
    this.submissions.push(prepared);
    return { success: !this.pending, transaction: prepared.transaction, network: requirements.network, payer,
      ...(this.pending ? { errorReason: 'settlement_pending' } : {}) };
  }
}
