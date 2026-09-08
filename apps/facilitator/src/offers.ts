import type { Tenant } from './config';
import { UDID, UCAN, type Offer, type OfferInput, type Requirements } from './model';
import { hashObject, requireThat } from './util';

export function paymentRule(tenant: Tenant, r: Requirements) {
  const rule = tenant.rules.find(rule => rule.scheme === r.scheme && rule.network === r.network && rule.asset === r.asset && rule.payTo === r.payTo);
  requireThat(rule && BigInt(r.amount) > 0n && BigInt(r.amount) <= BigInt(rule.maxAmount), 'payment_policy_rejected', 403);
  requireThat(r.extra.paymentFlow === undefined || r.extra.paymentFlow === 'authorization', 'unsupported_payment_flow');
  return rule;
}
export async function createOffer(input: OfferInput, tenant: Tenant, now: number): Promise<Offer> {
  paymentRule(tenant, input.paymentRequirements);
  const requireUcan = tenant.requireUcan || input.requireUcan === true;
  const requireUdid = tenant.requireUdid || input.requireUdid === true;
  requireThat(!requireUcan || tenant.authority, 'authority_not_configured');
  requireThat(!requireUdid || tenant.decision, 'decision_not_configured');
  const id = crypto.randomUUID();
  const bindingDigest = await hashObject(input.paymentRequirements);
  const capabilityDigest = await hashObject({ id, resource: input.resource.url, bindingDigest });
  return {
    id, tenantId: tenant.id, createdAt: now,
    expiresAt: now + input.paymentRequirements.maxTimeoutSeconds * 1000,
    resource: input.resource, requirements: input.paymentRequirements, bindingDigest,
    requireUcan, requireUdid, holderBinding: tenant.decision?.holderBinding ?? 'none',
    capability: { with: { scheme: 'x402', hierPart: capabilityDigest.slice(7) }, can: { namespace: 'payment', segments: ['settle'] } },
  };
}
export function advertise(offer: Offer, tenant: Tenant) {
  const extensions: Record<string, unknown> = {};
  if (offer.requireUcan) extensions[UCAN] = {
    version: '1', required: true, profile: 'ucan-0.8.1',
    audience: tenant.authority!.audience, capability: offer.capability,
  };
  if (offer.requireUdid) extensions[UDID] = {
    version: '1', required: true, offerId: offer.id, bindingDigest: offer.bindingDigest,
    credentialTypes: ['DecisionCredential', 'DecisionToPayCredential'],
    presentationFormats: [offer.holderBinding === 'none' ? 'jwt_vc_json' : 'jwt_vp_json'],
    holderBinding: offer.holderBinding, authority: { required: offer.requireUcan },
  };
  return {
    offerId: offer.id, expiresAt: new Date(offer.expiresAt).toISOString(),
    paymentRequired: { x402Version: 2, resource: offer.resource, accepts: [offer.requirements], extensions },
  };
}
