import { readFile, writeFile } from 'node:fs/promises';
import { CompactSign, importJWK, type JWK } from 'jose';
import { encode } from '@ucans/core';
import { privateKeyToAccount } from 'viem/accounts';
import { authorizationTypes } from '@x402/evm';
import type { Hex } from 'viem';
import { FacilitatorClient, encodeHeader } from '../src/client';
import { configSchema } from '../src/config';
import { UCAN, UDID, type Payment } from '../src/model';
import { canonical, hashObject, sha256 } from '../src/util';
import { ucan } from '../src/proofs/ucan';
import { authoritySigner } from './demo-keys';

const demo = JSON.parse(await readFile('.demo.json', 'utf8')) as { root: JWK; agent: JWK; audience: JWK; evaluator: JWK; issuer: string; payerKey: Hex; apiKey: string; config: unknown };
const config = configSchema.parse(demo.config), tenant = config.tenants[0]!, rule = tenant.rules[0]!;
const client = new FacilitatorClient(process.env.FACILITATOR_URL ?? 'http://localhost:8787', demo.apiKey);
const resume = process.argv.includes('--resume');
let offer: Awaited<ReturnType<typeof client.createOffer>>, payment: Payment;
if (resume) ({ offer, payment } = JSON.parse(await readFile('.demo-payment.json', 'utf8')));
else {
  offer = await client.createOffer({ resource: { url: 'https://resource.example.test/weather', description: 'Demo weather report', mimeType: 'application/json' },
    paymentRequirements: { scheme: 'exact', network: rule.network, asset: rule.asset, payTo: rule.payTo, amount: '100000', maxTimeoutSeconds: 120, extra: { name: 'USDC', version: '2' } } });
  console.log('402 Payment Required', { 'PAYMENT-REQUIRED': encodeHeader(offer.paymentRequired) });
  const exp = Math.floor(Date.parse(offer.expiresAt) / 1000), requirements = offer.paymentRequired.accepts[0]!;
  const authority = offer.paymentRequired.extensions[UCAN] as { audience: string; capability: Parameters<typeof ucan.build>[0]['capabilities'] extends (infer T)[] | undefined ? T : never };
  const root = await authoritySigner(demo.root), agent = await authoritySigner(demo.agent);
  const delegation = encode(await ucan.build({ issuer: root, audience: agent.did(), capabilities: [authority.capability], expiration: exp }));
  const token = encode(await ucan.build({ issuer: agent, audience: authority.audience, capabilities: [authority.capability], expiration: exp, proofs: [delegation] }));
  const account = privateKeyToAccount(demo.payerKey);
  const a = { from: account.address, to: requirements.payTo as Hex, value: BigInt(requirements.amount),
    validAfter: BigInt(Math.floor(Date.now() / 1000) - 10), validBefore: BigInt(exp),
    nonce: `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')}` as Hex };
  const signature = await account.signTypedData({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: requirements.asset as Hex },
    primaryType: 'TransferWithAuthorization', types: authorizationTypes, message: a });
  const policy = tenant.decision!.policies[0]!;
  const vc = { '@context': ['https://www.w3.org/ns/credentials/v2'], id: `urn:uuid:${crypto.randomUUID()}`,
    type: ['VerifiableCredential', 'DecisionCredential', 'DecisionToPayCredential'], issuer: demo.issuer,
    validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(exp * 1000).toISOString(),
    credentialSubject: { id: `urn:request:${offer.offerId}`, decision: { id: `urn:uuid:${crypto.randomUUID()}`, type: 'decision_to_pay', outcome: 'approved',
      evaluatedAt: new Date().toISOString(), authorityReference: await sha256(token),
      policy: { id: policy.id, version: policy.version, digest: await sha256(policy.bytes) },
      binding: { offerId: offer.offerId, bindingDigest: await hashObject(requirements), resource: offer.paymentRequired.resource.url,
        network: requirements.network, asset: requirements.asset, payTo: requirements.payTo, amount: requirements.amount } } } };
  const presentation = await new CompactSign(new TextEncoder().encode(canonical(vc))).setProtectedHeader({ alg: 'EdDSA', typ: 'vc+jwt', kid: `${demo.issuer}#key-1` }).sign(await importJWK(demo.evaluator, 'EdDSA'));
  payment = { x402Version: 2, resource: offer.paymentRequired.resource, accepted: requirements,
    payload: { signature, authorization: { ...a, value: a.value.toString(), validAfter: a.validAfter.toString(), validBefore: a.validBefore.toString() } },
    extensions: { [UCAN]: { token }, [UDID]: { format: 'jwt_vc_json', presentation } } };
  const verified = await client.verify(offer, payment);
  console.log('Verification:', verified);
  if (!verified.isValid) process.exit(1);
  await writeFile('.demo-payment.json', JSON.stringify({ offer, payment }), { mode: 0o600 });
}
const receipt = await client.settle(offer, payment);
console.log('Settlement:', receipt);
if (receipt.success) console.log('200 OK', { 'PAYMENT-RESPONSE': encodeHeader(receipt) }, { weather: 'Demo report; no external weather data was fetched.' });
else { console.log('No resource returned. Resume this exact payment with npm run demo -- --resume.'); process.exitCode = 1; }
