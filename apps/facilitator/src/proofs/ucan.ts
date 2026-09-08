import { getPluginInjectedApi, parse, Plugins, type DidableKey, type Ucan } from '@ucans/core';
import { base58btc } from 'multiformats/bases/base58';
import { base64url, decodeProtectedHeader } from 'jose';
import type { Tenant } from '../config';
import type { Offer } from '../model';
import { AppError, canonical, requireThat, sha256 } from '../util';

export const ucan = getPluginInjectedApi(new Plugins([{
  prefix: new Uint8Array([0xed, 0x01]), jwtAlg: 'EdDSA',
  async verifySignature(did, data, signature) {
    const bytes = base58btc.decode(did.slice('did:key:'.length));
    requireThat(bytes.length === 34 && bytes[0] === 0xed && bytes[1] === 1, 'unsupported_ucan_key');
    const key = await crypto.subtle.importKey('raw', bytes.slice(2), 'Ed25519', false, ['verify']);
    return crypto.subtle.verify('Ed25519', key, new Uint8Array(signature), new Uint8Array(data));
  },
}], {}));

/** An explicit UCAN 0.8.1 profile: Ed25519 did:key, inline proofs, exact capabilities. */
export async function verifyAuthority(token: string, tenant: Tenant, offer: Offer, payer: string): Promise<string> {
  const policy = tenant.authority;
  requireThat(policy, 'authority_not_configured', 403);
  const root = policy.roots.find(r => r.payer === payer);
  requireThat(root, 'unknown_authority_root', 403);
  const queue = [{ token, depth: 0 }];
  const chain: Ucan[] = [];
  let visited = 0;
  while (queue.length) {
    const item = queue.pop()!;
    requireThat(++visited <= 16 && item.depth <= 8 && item.token.length <= 48_000, 'ucan_chain_too_large');
    const parts = item.token.split('.');
    requireThat(parts.length === 3 && parts.every(p => base64url.encode(base64url.decode(p)) === p), 'invalid_ucan_encoding');
    const header = decodeProtectedHeader(item.token);
    requireThat(header.alg === 'EdDSA' && header.typ === 'JWT' && header.ucv === '0.8.1' && !header.crit, 'unsupported_ucan_profile');
    const parsed = parse(item.token);
    requireThat(Number.isSafeInteger(parsed.payload.exp) && parsed.payload.exp > Math.floor(Date.now() / 1000), 'expired_ucan');
    requireThat(parsed.payload.nbf === undefined || Number.isSafeInteger(parsed.payload.nbf), 'invalid_ucan_time');
    requireThat(parsed.payload.att.length === 1 && canonical(parsed.payload.att[0]) === canonical(offer.capability), 'ucan_capability_mismatch', 403);
    requireThat(!policy.revokedTokenDigests.includes(await sha256(item.token)), 'revoked_ucan', 403);
    requireThat(parsed.payload.prf.length <= 1, 'unsupported_ucan_proof_bundle');
    const validated = await ucan.validate(item.token).catch(() => { throw new AppError('invalid_ucan_signature_or_time', 403); });
    chain.push(validated);
    for (const proof of parsed.payload.prf) queue.push({ token: proof, depth: item.depth + 1 });
  }
  requireThat(chain[0]?.payload.aud === policy.audience, 'ucan_audience_mismatch', 403);
  // The pinned library verifies each token. This narrow profile owns delegation semantics,
  // including time containment; it does not use the library's legacy validateProofs check.
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]!.payload, parent = chain[i + 1]!.payload;
    requireThat(child.iss === parent.aud, 'ucan_proof_link_mismatch', 403);
    requireThat(child.exp <= parent.exp && (parent.nbf === undefined || (child.nbf !== undefined && child.nbf >= parent.nbf)), 'ucan_time_attenuation_failed', 403);
  }
  requireThat(chain.at(-1)?.payload.iss === root.issuer, 'untrusted_ucan_root', 403);
  return sha256(token);
}

/** Used by the local demo and by operators building an issuer; private keys stay with the caller. */
export async function createAuthorityKey(): Promise<DidableKey> {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const did = `did:key:${base58btc.encode(new Uint8Array([0xed, 1, ...raw]))}`;
  return { did: () => did, jwtAlg: 'EdDSA', sign: async data => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new Uint8Array(data))) };
}
