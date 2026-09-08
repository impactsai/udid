import { base58btc } from 'multiformats/bases/base58';
import { base64url, importJWK, type JWK } from 'jose';
import type { DidableKey } from '@ucans/core';

export async function authoritySigner(jwk: JWK): Promise<DidableKey> {
  const publicBytes = base64url.decode(jwk.x!);
  const did = `did:key:${base58btc.encode(new Uint8Array([0xed, 1, ...publicBytes]))}`;
  const key = await importJWK(jwk, 'EdDSA') as CryptoKey;
  return { did: () => did, jwtAlg: 'EdDSA', sign: async bytes => new Uint8Array(await crypto.subtle.sign('Ed25519', key, new Uint8Array(bytes))) };
}
