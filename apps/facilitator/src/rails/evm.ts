import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import type { FacilitatorEvmSigner } from '@x402/evm';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { createPublicClient, defineChain, encodeFunctionData, getAddress, http, keccak256, parseAbi, parseEventLogs, parseSignature, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import type { OperatorConfig } from '../config';
import { address, atomicAmount, type Offer, type Payment, type PreparedPayment, type RailAdapter, type Requirements, type SettlementResult } from '../model';
import { AppError, hashObject, requireThat } from '../util';

export const authorizationSchema = z.object({
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  authorization: z.object({
    from: address, to: address, value: atomicAmount, validAfter: atomicAmount, validBefore: atomicAmount,
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }).strict(),
}).strict();
const transferAbi = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

export class EvmRail implements RailAdapter {
  private account;
  private client;
  private chain;
  private scheme;
  constructor(private config: OperatorConfig['evm'][number], key: Hex, rpcFetch?: typeof fetch) {
    this.account = privateKeyToAccount(key);
    const id = Number(config.network.slice(7));
    requireThat(Number.isSafeInteger(id), 'invalid_chain_id');
    this.chain = defineChain({ id, name: config.network, nativeCurrency: { name: 'Gas', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
    this.client = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl, { timeout: 5000, retryCount: 0, fetchFn: rpcFetch }) });
    const noWrite = async (): Promise<never> => { throw new AppError('write_during_verify'); };
    const signer: FacilitatorEvmSigner = {
      getAddresses: () => [this.account.address],
      readContract: args => this.client.readContract(args as Parameters<typeof this.client.readContract>[0]),
      verifyTypedData: args => this.client.verifyTypedData(args as Parameters<typeof this.client.verifyTypedData>[0]),
      getCode: args => this.client.getCode(args),
      writeContract: noWrite, sendTransaction: noWrite, waitForTransactionReceipt: noWrite,
    };
    this.scheme = new ExactEvmScheme(signer);
  }
  payer(payment: Payment) { return getAddress(authorizationSchema.parse(payment.payload).authorization.from); }
  async paymentKey(payment: Payment) {
    const a = authorizationSchema.parse(payment.payload).authorization;
    return hashObject([payment.accepted.network, payment.accepted.asset.toLowerCase(), a.from.toLowerCase(), a.nonce.toLowerCase()]);
  }
  async verify(payment: Payment, requirements: Requirements, offer: Offer) {
    const { authorization: a } = authorizationSchema.parse(payment.payload);
    const asset = this.config.assets.find(asset => asset.address === requirements.asset);
    requireThat(requirements.network === this.config.network && asset && requirements.extra.name === asset.name && requirements.extra.version === asset.version, 'unsupported_asset');
    requireThat(requirements.extra.assetTransferMethod === undefined || requirements.extra.assetTransferMethod === 'eip3009', 'unsupported_transfer_method');
    requireThat(BigInt(a.validBefore) * 1000n <= BigInt(offer.expiresAt), 'authorization_exceeds_offer');
    requireThat(BigInt(a.validBefore) > BigInt(Math.floor(Date.now() / 1000)) && BigInt(a.validAfter) < BigInt(Math.floor(Date.now() / 1000)), 'authorization_time_invalid');
    requireThat(await this.client.getChainId() === this.chain.id, 'rpc_chain_mismatch', 503);
    const code = await this.client.getCode({ address: getAddress(a.from) });
    requireThat(!code || code === '0x', 'unsupported_contract_wallet');
    const verified = await this.scheme.verify(payment as PaymentPayload, requirements as PaymentRequirements);
    return { isValid: verified.isValid, payer: this.payer(payment), ...(verified.isValid ? {} : { invalidReason: verified.invalidReason ?? 'invalid_payment' }) };
  }
  async prepare(payment: Payment, requirements: Requirements, nonceFloor = 0): Promise<PreparedPayment> {
    const { authorization: a, signature } = authorizationSchema.parse(payment.payload);
    const sig = parseSignature(signature as Hex);
    const data = encodeFunctionData({ abi: transferAbi, functionName: 'transferWithAuthorization', args: [
      getAddress(a.from), getAddress(a.to), BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce as Hex,
      Number(sig.v ?? BigInt(27 + (sig.yParity ?? 0))), sig.r, sig.s,
    ] });
    const to = getAddress(requirements.asset);
    const estimate = await this.client.estimateGas({ account: this.account, to, data });
    const gas = estimate * 12n / 10n;
    requireThat(gas <= BigInt(this.config.maxGas), 'gas_limit_exceeded', 403);
    const fees = await this.client.estimateFeesPerGas();
    requireThat(fees.maxFeePerGas <= BigInt(this.config.maxFeePerGas), 'gas_price_exceeded', 503);
    const nonce = Math.max(nonceFloor, await this.client.getTransactionCount({ address: this.account.address, blockTag: 'pending' }));
    const rawTransaction = await this.account.signTransaction({
      chainId: this.chain.id, type: 'eip1559', to, data, gas, nonce,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    return { transaction: keccak256(rawTransaction), rawTransaction, nonce };
  }
  async submit(prepared: PreparedPayment, requirements: Requirements, payer: string): Promise<SettlementResult> {
    requireThat(prepared.rawTransaction, 'missing_signed_transaction', 503);
    const hash = prepared.transaction as Hex;
    const base = { transaction: hash, network: requirements.network, payer };
    try {
      const existing = await this.client.getTransactionReceipt({ hash }).catch(() => undefined);
      if (!existing) await this.client.sendRawTransaction({ serializedTransaction: prepared.rawTransaction }).catch(() => undefined);
      const receipt = await this.client.waitForTransactionReceipt({ hash, confirmations: this.config.confirmations, timeout: 8000, pollingInterval: 1000 });
      if (receipt.status === 'reverted') return { ...base, success: false, errorReason: 'transaction_reverted' };
      const events = parseEventLogs({ abi: transferAbi, eventName: 'Transfer', logs: receipt.logs });
      const paid = events.some(event => event.address.toLowerCase() === requirements.asset.toLowerCase()
        && event.args.from.toLowerCase() === payer.toLowerCase()
        && event.args.to.toLowerCase() === requirements.payTo.toLowerCase()
        && event.args.value === BigInt(requirements.amount));
      return paid ? { ...base, success: true } : { ...base, success: false, errorReason: 'transfer_event_mismatch' };
    } catch { return { ...base, success: false, errorReason: 'settlement_pending' }; }
  }
}
