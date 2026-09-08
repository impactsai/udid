import { access, writeFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK } from 'jose';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sha256 } from '../src/util';
import { configSchema } from '../src/config';
import { authoritySigner } from './demo-keys';

const exists = (path: string) => access(path).then(() => true, () => false);
if (await exists('.demo.json') || await exists('.dev.vars')) {
  console.log('Demo files already exist. Keep them to preserve your addresses, or move them before generating new keys.');
  process.exit(0);
}
async function key() { return exportJWK((await generateKeyPair('EdDSA', { extractable: true })).privateKey); }
const root = await key(), agent = await key(), audience = await key(), evaluator = await key();
const payerKey = generatePrivateKey(), facilitatorKey = generatePrivateKey(), payee = privateKeyToAccount(generatePrivateKey()).address;
const payer = privateKeyToAccount(payerKey).address, facilitator = privateKeyToAccount(facilitatorKey).address;
const apiKey = crypto.randomUUID() + crypto.randomUUID();
const issuer = 'did:web:demo-evaluator.example.test';
const { d: _private, ...publicJwk } = evaluator;
const config = configSchema.parse({ tenants: [{ id: 'demo', apiKeyHash: await sha256(apiKey), requireUcan: true, requireUdid: true,
  rules: [{ scheme: 'exact', network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: payee,
    maxAmount: '100000', dailyBudget: '1000000' }],
  authority: { audience: (await authoritySigner(audience)).did(), roots: [{ payer, issuer: (await authoritySigner(root)).did() }] },
  decision: { trustedIssuers: [issuer], keys: [{ kid: `${issuer}#key-1`, controller: issuer, purpose: 'assertionMethod', jwk: publicJwk }],
    policies: [{ id: 'urn:demo:policy', version: '1', bytes: 'Demo only: approve one weather request costing at most 0.10 test USDC.' }] },
}], evm: [{ network: 'eip155:84532', rpcUrl: process.env.DEMO_RPC_URL ?? 'https://sepolia.base.org',
  assets: [{ address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', name: 'USDC', version: '2' }] }] });
await writeFile('.demo.json', JSON.stringify({ root, agent, audience, evaluator, issuer, payerKey, apiKey, config }, null, 2), { mode: 0o600, flag: 'wx' });
await writeFile('.dev.vars', `OPERATOR_CONFIG_JSON='${JSON.stringify(config).replace(/'/g, '\\u0027')}'\nEVM_PRIVATE_KEY=${facilitatorKey}\n`, { mode: 0o600, flag: 'wx' });
console.log(`Created private local demo files. Base Sepolia only.\nPayer (needs test USDC): ${payer}\nFacilitator (needs test ETH for gas): ${facilitator}\nPayee: ${payee}\nRun npm run dev, then npm run demo. Demo keys are not production keys.`);
