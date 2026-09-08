import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationTypes } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem';
import { EvmRail } from '../src/rails/evm';
import { fixture, requirements } from './fixtures';

const key = `0x${'1'.repeat(64)}` as Hex, gasKey = `0x${'2'.repeat(64)}` as Hex;
async function setup() {
  const f = await fixture('none'), account = privateKeyToAccount(key), gasAccount = privateKeyToAccount(gasKey);
  const a = { from: account.address, to: requirements.payTo as Hex, value: BigInt(requirements.amount), validAfter: BigInt(Math.floor(Date.now() / 1000) - 10),
    validBefore: BigInt(Math.floor(f.offer.expiresAt / 1000)), nonce: `0x${'a'.repeat(64)}` as Hex };
  const signature = await account.signTypedData({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: requirements.asset as Hex }, types: authorizationTypes, primaryType: 'TransferWithAuthorization', message: a });
  f.request.paymentPayload.payload = { signature, authorization: { ...a, value: a.value.toString(), validAfter: a.validAfter.toString(), validBefore: a.validBefore.toString() } };
  const methods: string[] = [], rawTransactions: Hex[] = [];
  let broadcastHash: Hex | undefined;
  const state = { chainId: '0x14a34', eventAmount: 100000n, reverted: false, contractPayer: false };
  const rpcFetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { id: number; method: string; params: unknown[] };
    methods.push(body.method);
    let result: unknown;
    switch (body.method) {
      case 'eth_chainId': result = state.chainId; break;
      case 'eth_getCode': result = String(body.params[0]).toLowerCase() === requirements.asset.toLowerCase() || state.contractPayer ? '0x01' : '0x'; break;
      case 'eth_call': result = '0x'; break;
      case 'eth_estimateGas': result = '0x10000'; break;
      case 'eth_maxPriorityFeePerGas': result = '0x1'; break;
      case 'eth_getTransactionCount': result = '0x3'; break;
      case 'eth_blockNumber': result = '0x20'; break;
      case 'eth_getBlockByNumber': result = { number: '0x20', hash: `0x${'c'.repeat(64)}`, timestamp: '0x1', baseFeePerGas: '0x1', transactions: [], uncles: [], gasLimit: '0x100000', gasUsed: '0x0' }; break;
      case 'eth_sendRawTransaction': rawTransactions.push(body.params[0] as Hex); broadcastHash = keccak256(body.params[0] as Hex); result = broadcastHash; break;
      case 'eth_getTransactionReceipt': result = broadcastHash ? {
        transactionHash: broadcastHash, transactionIndex: '0x0', blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0x20', from: gasAccount.address,
        to: requirements.asset, cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x2', contractAddress: null,
        status: state.reverted ? '0x0' : '0x1', type: '0x2', logsBloom: `0x${'0'.repeat(512)}`,
        logs: [{ address: requirements.asset, blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0x20', transactionHash: broadcastHash,
          transactionIndex: '0x0', logIndex: '0x0', removed: false,
          topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']), eventName: 'Transfer', args: { from: account.address, to: requirements.payTo as Hex } }),
          data: encodeAbiParameters([{ type: 'uint256' }], [state.eventAmount]) }],
      } : null; break;
      default: throw new Error(`Unhandled RPC method ${body.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  }) as typeof fetch;
  const rail = new EvmRail({ ...f.config.evm[0]!, confirmations: 1 }, gasKey, rpcFetch);
  return { ...f, rail, methods, rawTransactions, state, account, gasAccount };
}
test('EIP-712 verification, prepared transaction and confirmed transfer use the actual EVM adapter', async () => {
  const f = await setup();
  assert.equal((await f.rail.verify(f.request.paymentPayload, requirements, f.offer)).isValid, true);
  assert.ok(!f.methods.includes('eth_sendRawTransaction'));
  const prepared = await f.rail.prepare(f.request.paymentPayload, requirements, 7);
  assert.equal(prepared.nonce, 7); assert.equal(f.rawTransactions.length, 0);
  const decoded = parseTransaction(prepared.rawTransaction!);
  assert.equal(decoded.chainId, 84532); assert.equal(decoded.to?.toLowerCase(), requirements.asset.toLowerCase());
  assert.equal(await recoverTransactionAddress({ serializedTransaction: prepared.rawTransaction! as TransactionSerialized }), f.gasAccount.address);
  assert.equal((await f.rail.submit(prepared, requirements, f.account.address)).success, true);
  assert.equal((await f.rail.submit(prepared, requirements, f.account.address)).success, true);
  assert.equal(f.rawTransactions.length, 1);
});
test('EVM rejects invalid wallet signature before settlement', async () => {
  const f = await setup(); f.request.paymentPayload.payload.signature = `0x${'a'.repeat(128)}1b`;
  assert.equal((await f.rail.verify(f.request.paymentPayload, requirements, f.offer)).isValid, false);
  assert.ok(!f.methods.includes('eth_sendRawTransaction'));
});
test('EVM fails closed on RPC chain mismatch and unsupported smart wallet', async () => {
  const f = await setup(); f.state.chainId = '0x1';
  await assert.rejects(f.rail.verify(f.request.paymentPayload, requirements, f.offer), /rpc_chain_mismatch/);
  f.state.chainId = '0x14a34'; f.state.contractPayer = true;
  await assert.rejects(f.rail.verify(f.request.paymentPayload, requirements, f.offer), /unsupported_contract_wallet/);
});
for (const kind of ['wrong_event', 'reverted'] as const) test(`EVM refuses a ${kind} receipt`, async () => {
  const f = await setup();
  if (kind === 'wrong_event') f.state.eventAmount = 1n; else f.state.reverted = true;
  const result = await f.rail.submit(await f.rail.prepare(f.request.paymentPayload, requirements), requirements, f.account.address);
  assert.equal(result.success, false);
  assert.equal(result.errorReason, kind === 'wrong_event' ? 'transfer_event_mismatch' : 'transaction_reverted');
});
