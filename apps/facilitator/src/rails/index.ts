import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { OperatorConfig, RuntimeEnv } from '../config';
import { UCAN, UDID, type RailAdapter, type Requirements } from '../model';
import { requireThat } from '../util';
import { EvmRail } from './evm';
import { StripeRail } from './stripe';

export function resolveRail(config: OperatorConfig, env: RuntimeEnv, r: Requirements): RailAdapter {
  if (r.scheme === 'exact') {
    const network = config.evm.find(e => e.network === r.network);
    requireThat(network && /^0x[0-9a-fA-F]{64}$/.test(env.EVM_PRIVATE_KEY ?? ''), 'evm_not_configured', 503);
    return new EvmRail(network, env.EVM_PRIVATE_KEY as Hex);
  }
  requireThat(config.stripe && config.stripe.network === r.network && env.STRIPE_SECRET_KEY, 'stripe_not_configured', 503);
  return new StripeRail(config.stripe, env.STRIPE_SECRET_KEY);
}
export function supported(config: OperatorConfig, env: RuntimeEnv) {
  const kinds: { x402Version: number; scheme: string; network: string }[] = [];
  const signers: Record<string, string[]> = {};
  if (/^0x[0-9a-fA-F]{64}$/.test(env.EVM_PRIVATE_KEY ?? '')) {
    const signer = privateKeyToAccount(env.EVM_PRIVATE_KEY as Hex).address;
    for (const network of config.evm) {
      kinds.push({ x402Version: 2, scheme: 'exact', network: network.network });
      signers[network.network] = [signer];
    }
  }
  if (config.stripe && env.STRIPE_SECRET_KEY) kinds.push({ x402Version: 2, scheme: 'stripe-manual-capture', network: config.stripe.network });
  return { kinds, extensions: [UCAN, UDID], signers };
}
