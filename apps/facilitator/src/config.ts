import { z } from 'zod';
import { address, atomicAmount, digest } from './model';
import { AppError, requireThat, sha256 } from './util';

const publicKey = z.object({
  kid: z.string().min(1),
  controller: z.string().min(1),
  purpose: z.enum(['assertionMethod', 'authentication']),
  jwk: z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string().min(1) }).strict(),
}).strict();
const authoritySchema = z.object({
  audience: z.string().startsWith('did:key:'),
  roots: z.array(z.object({ payer: z.string().min(1), issuer: z.string().startsWith('did:key:') }).strict()),
  revokedTokenDigests: z.array(digest).default([]),
}).strict();
const decisionSchema = z.object({
  keys: z.array(publicKey),
  trustedIssuers: z.array(z.string().min(1)),
  policies: z.array(z.object({ id: z.string().min(1), version: z.string().min(1), bytes: z.string().max(16_384) }).strict()),
  holderBinding: z.enum(['none', 'did-authentication']).default('none'),
  holders: z.array(z.object({ payer: z.string().min(1), did: z.string().min(1) }).strict()).default([]),
  requireStatus: z.boolean().default(false),
  revokedDecisionIds: z.array(z.object({ issuer: z.string(), id: z.string() }).strict()).default([]),
}).strict();
const ruleSchema = z.object({
  scheme: z.enum(['exact', 'stripe-manual-capture']),
  network: z.string(), asset: z.string(), payTo: z.string(),
  maxAmount: atomicAmount, dailyBudget: atomicAmount,
}).strict();
export const tenantSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  apiKeyHash: digest,
  requireUcan: z.boolean().default(false),
  requireUdid: z.boolean().default(false),
  requestsPerMinute: z.number().int().min(1).max(1000).default(60),
  rules: z.array(ruleSchema).min(1),
  authority: authoritySchema.optional(),
  decision: decisionSchema.optional(),
}).strict();
export const configSchema = z.object({
  tenants: z.array(tenantSchema),
  evm: z.array(z.object({
    network: z.string().regex(/^eip155:[1-9][0-9]*$/),
    rpcUrl: z.url().refine(v => v.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(v)),
    assets: z.array(z.object({ address, name: z.string().min(1), version: z.string().min(1) }).strict()).min(1),
    maxGas: atomicAmount.default('200000'),
    maxFeePerGas: atomicAmount.default('100000000000'),
    confirmations: z.number().int().min(1).max(64).default(2),
  }).strict()).default([]),
  stripe: z.object({
    network: z.enum(['stripe:test', 'stripe:live']),
    account: z.string().regex(/^acct_[a-zA-Z0-9]+$/),
  }).strict().optional(),
}).strict();
export type OperatorConfig = z.infer<typeof configSchema>;
export type Tenant = z.infer<typeof tenantSchema>;
export interface RuntimeEnv {
  OPERATOR_CONFIG_JSON: string;
  EVM_PRIVATE_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STATUS_CHECKER?: Fetcher;
}
export function loadConfig(env: RuntimeEnv): OperatorConfig {
  try {
    const config = configSchema.parse(JSON.parse(env.OPERATOR_CONFIG_JSON ?? '{"tenants":[],"evm":[]}'));
    requireThat(new Set(config.tenants.map(t => t.id)).size === config.tenants.length, 'duplicate_tenant');
    requireThat(new Set(config.tenants.map(t => t.apiKeyHash)).size === config.tenants.length, 'duplicate_api_key');
    requireThat(new Set(config.evm.map(e => e.network)).size === config.evm.length, 'duplicate_network');
    for (const t of config.tenants) {
      requireThat(!t.requireUcan || t.authority, 'authority_not_configured');
      requireThat(!t.requireUdid || t.decision, 'decision_not_configured');
    }
    return config;
  } catch { throw new AppError('operator_not_configured', 503); }
}
export async function authenticate(request: Request, config: OperatorConfig): Promise<Tenant> {
  const header = request.headers.get('authorization');
  requireThat(header !== null && header.startsWith('Bearer ') && header.length >= 39 && header.length <= 512, 'unauthorized', 401);
  const keyHash = await sha256(header.slice(7));
  const tenant = config.tenants.find(t => t.apiKeyHash === keyHash);
  requireThat(tenant, 'unauthorized', 401);
  return tenant;
}
