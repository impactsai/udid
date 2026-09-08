import { compactVerify, decodeProtectedHeader, importJWK } from 'jose';
import { z } from 'zod';
import type { RuntimeEnv, Tenant } from '../config';
import { atomicAmount, digest, type Offer, type ProofResult } from '../model';
import { AppError, canonical, hashObject, requireThat, sha256 } from '../util';

const dateTime = z.iso.datetime({ offset: true });
const bindingSchema = z.object({
  offerId: z.string().min(1), bindingDigest: digest, resource: z.url(), network: z.string().min(1),
  asset: z.string().min(1), payTo: z.string().min(1), amount: atomicAmount,
}).strict();
export const credentialSchema = z.object({
  '@context': z.array(z.string()).refine(v => v[0] === 'https://www.w3.org/ns/credentials/v2'),
  id: z.string().min(1), type: z.array(z.string()), issuer: z.string().min(1),
  validFrom: dateTime, validUntil: dateTime,
  credentialStatus: z.object({ id: z.url(), type: z.string().min(1) }).passthrough().optional(),
  credentialSubject: z.object({
    id: z.string().min(1),
    decision: z.object({
      id: z.string().min(1), type: z.literal('decision_to_pay'), outcome: z.enum(['approved', 'declined']),
      evaluatedAt: dateTime, reasonCodes: z.array(z.string()).optional(), authorityReference: z.string().min(1).optional(),
      policy: z.object({ id: z.string().min(1), version: z.string().min(1), digest }).strict(),
      binding: bindingSchema,
    }).strict(),
  }).strict(),
}).strict();

async function verifyJws(token: string, tenant: Tenant, typ: string, purpose: 'assertionMethod' | 'authentication') {
  const header = decodeProtectedHeader(token);
  requireThat(header.typ === typ && header.alg === 'EdDSA' && typeof header.kid === 'string', 'unsupported_proof_format', 403);
  const method = tenant.decision?.keys.find(k => k.kid === header.kid && k.purpose === purpose);
  requireThat(method, 'untrusted_verification_method', 403);
  const verified = await compactVerify(token, await importJWK(method.jwk, 'EdDSA'), { algorithms: ['EdDSA'] })
    .catch(() => { throw new AppError('invalid_credential_signature', 403); });
  return { document: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(verified.payload)) as unknown, controller: method.controller };
}

export async function verifyDecision(
  presentation: { format: string; presentation: string }, tenant: Tenant, offer: Offer,
  payer: string, authorityDigest: string | undefined, env: RuntimeEnv, now: number,
): Promise<NonNullable<ProofResult['decision']>> {
  const policy = tenant.decision;
  requireThat(policy, 'decision_not_configured', 403);
  let token = presentation.presentation;
  if (offer.holderBinding === 'did-authentication') {
    requireThat(presentation.format === 'jwt_vp_json', 'holder_proof_required', 403);
    const secured = await verifyJws(token, tenant, 'vp+jwt', 'authentication');
    const vp = z.object({
      '@context': z.array(z.string()), type: z.array(z.string()), holder: z.string(),
      aud: z.string(), nonce: z.string(), exp: z.number().int(),
      verifiableCredential: z.array(z.string()).length(1),
    }).strict().parse(secured.document);
    const holder = policy.holders.find(h => h.payer === payer);
    requireThat(holder && vp.holder === holder.did && secured.controller === holder.did, 'holder_mismatch', 403);
    requireThat(vp['@context'][0] === 'https://www.w3.org/ns/credentials/v2' && vp.type.includes('VerifiablePresentation'), 'invalid_presentation', 403);
    requireThat(vp.aud === offer.resource.url && vp.nonce === offer.id && vp.exp * 1000 > now && vp.exp * 1000 <= offer.expiresAt, 'holder_binding_mismatch', 403);
    token = vp.verifiableCredential[0]!;
  } else requireThat(presentation.format === 'jwt_vc_json', 'unsupported_proof_format', 403);

  const secured = await verifyJws(token, tenant, 'vc+jwt', 'assertionMethod');
  const vc = credentialSchema.parse(secured.document);
  requireThat(secured.controller === vc.issuer && policy.trustedIssuers.includes(vc.issuer), 'untrusted_issuer', 403);
  requireThat(['VerifiableCredential', 'DecisionCredential', 'DecisionToPayCredential'].every(t => vc.type.includes(t)), 'invalid_credential_type', 403);
  const start = Date.parse(vc.validFrom), end = Date.parse(vc.validUntil);
  requireThat(start <= now && end > now && end > start && end <= offer.expiresAt, 'credential_time_invalid', 403);
  const decision = vc.credentialSubject.decision;
  requireThat(Date.parse(decision.evaluatedAt) <= now && Date.parse(decision.evaluatedAt) <= end, 'invalid_evaluation_time', 403);
  requireThat(!policy.revokedDecisionIds.some(d => d.issuer === vc.issuer && d.id === decision.id), 'revoked_decision', 403);
  if (vc.credentialStatus || policy.requireStatus || end - start > 86_400_000) {
    requireThat(vc.credentialStatus && env.STATUS_CHECKER, 'credential_status_unavailable', 503);
    const status = await env.STATUS_CHECKER.fetch('https://status.internal/check', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ issuer: vc.issuer, credentialId: vc.id, credentialStatus: vc.credentialStatus }),
    });
    requireThat(status.ok, 'credential_status_unavailable', 503);
    const result = z.object({ active: z.boolean(), checkedAt: z.number(), issuer: z.string(), credentialId: z.string(), statusId: z.string() }).strict().parse(await status.json());
    requireThat(result.issuer === vc.issuer && result.credentialId === vc.id && result.statusId === vc.credentialStatus.id && result.checkedAt <= now + 1000 && result.checkedAt >= now - 30_000, 'invalid_status_response', 503);
    requireThat(result.active, 'revoked_or_suspended_credential', 403);
  }
  const acceptedPolicy = policy.policies.find(p => p.id === decision.policy.id && p.version === decision.policy.version);
  requireThat(acceptedPolicy && await sha256(acceptedPolicy.bytes) === decision.policy.digest, 'untrusted_policy', 403);
  requireThat(decision.outcome === 'approved', 'decision_declined', 403);
  const { network, asset, payTo, amount } = offer.requirements;
  requireThat(canonical(decision.binding) === canonical({ offerId: offer.id, bindingDigest: offer.bindingDigest, resource: offer.resource.url, network, asset, payTo, amount }), 'decision_binding_mismatch', 403);
  if (decision.authorityReference) requireThat(authorityDigest === decision.authorityReference, 'authority_reference_mismatch', 403);
  return { issuer: vc.issuer, id: decision.id, offerId: offer.id, replayKey: await hashObject([vc.issuer, decision.id, offer.id]) };
}
