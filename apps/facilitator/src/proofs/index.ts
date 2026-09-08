import { z } from 'zod';
import type { RuntimeEnv, Tenant } from '../config';
import { UCAN, UDID, type Offer, type Payment, type ProofResult } from '../model';
import { requireThat } from '../util';
import { verifyAuthority } from './ucan';
import { verifyDecision } from './udid';

export async function verifyProofs(payment: Payment, offer: Offer, tenant: Tenant, payer: string, env: RuntimeEnv, now: number): Promise<ProofResult> {
  const result: ProofResult = { ucan: 'not_requested', udid: 'not_requested' };
  const extensions = payment.extensions ?? {};
  requireThat(Object.keys(extensions).every(k => k === UCAN || k === UDID), 'unsupported_extension', 403);
  if (offer.requireUcan || extensions[UCAN] !== undefined) {
    requireThat(extensions[UCAN], 'ucan_required', 403);
    const proof = z.object({ token: z.string().min(1).max(48_000) }).strict().parse(extensions[UCAN]);
    result.authorityDigest = await verifyAuthority(proof.token, tenant, offer, payer);
    result.ucan = 'verified';
  }
  if (offer.requireUdid || extensions[UDID] !== undefined) {
    requireThat(extensions[UDID], 'udid_required', 403);
    const proof = z.object({ format: z.string(), presentation: z.string().min(1).max(48_000) }).strict().parse(extensions[UDID]);
    result.decision = await verifyDecision(proof, tenant, offer, payer, result.authorityDigest, env, now);
    result.udid = 'verified';
  }
  return result;
}
