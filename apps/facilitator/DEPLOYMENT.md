# Hosted test deployment

Deployed on **8 September 2026** to the operator's Cloudflare account.

- API: [udid-x402-facilitator.ixo-api.workers.dev](https://udid-x402-facilitator.ixo-api.workers.dev)
- [Health](https://udid-x402-facilitator.ixo-api.workers.dev/health) reports `configured: true`.
- [Supported protocols](https://udid-x402-facilitator.ixo-api.workers.dev/supported): EVM `exact`, Base Sepolia (`eip155:84532`), UCAN and UDID.
- Worker source: [`a33d5d1`](https://github.com/impactsai/udid/commit/a33d5d1fb00530688150ca7061987b42d2238129).
- Active Cloudflare version after provisioning secrets: `80475a1f-b7f6-46bb-aaf9-27618647631e`.
- Hosted CI for the Worker source: [facilitator validation](https://github.com/impactsai/udid/actions/runs/34184766088) and [draft validation](https://github.com/impactsai/udid/actions/runs/34184766116) passed.

This is a restricted testnet deployment. It requires an authenticated resource server and **both** UCAN and UDID. It does not enable mainnet, Stripe, or a simulated settlement rail. Operator and gas-wallet secrets are in Cloudflare secret bindings. Payer, authority and demo evaluator keys remain in ignored local files, not on the Worker or in Git.

## Test immediately without sending a payment

From `apps/facilitator` on the provisioned workstation:

```sh
FACILITATOR_URL=https://udid-x402-facilitator.ixo-api.workers.dev npm run smoke:deployed
```

The command uses the existing `.demo.json` credentials. It checks public health and supported networks, authenticated offer registration, rejection of absent UCAN or UDID, changed amounts, invalid payment signatures, and an attempt to call settlement without authority. It then verifies a genuinely signed UCAN chain, UDID credential and EIP-712 payment against the live Base Sepolia RPC. It does **not** submit a valid settlement.

For an unfunded payer, the final expected result is `invalid_exact_evm_insufficient_balance`. This demonstrates that the request reached the rail after proof verification; it is not a successful payment. If the payer has sufficient test USDC, this step instead expects `isValid: true`. Public RPC outages or timeouts return a failure from the script; retry the read-only check after the provider recovers.

Other testers need a separately provisioned resource-server key and tenant trust configuration. Running `demo:setup` on a different machine generates different credentials and does not grant access to this deployment. Use the [operator guide](README.md) to create an independent deployment or add a tenant deliberately.

## Complete a real testnet transfer

At deployment, both generated wallets were confirmed unfunded:

| Purpose | Base Sepolia address | Required asset |
| --- | --- | --- |
| Payer | `0xBcD7552d4fb01658F1Ab56b903e44C84220Ae6F5` | At least 0.10 **test USDC** |
| Facilitator gas wallet | `0xFDfa792C84A8338A01c231357c6a0d741CDAcA28` | **Test ETH** for gas |
| Merchant recipient | `0xd3F09728e51B1a7845755d18F2152C7BdbD655C2` | Receives the demo payment |

Obtain test USDC from the [Circle faucet](https://faucet.circle.com/) with **Base Sepolia** selected, and test ETH using the options in [Base's funding guide](https://docs.base.org/get-started/get-funds). These are testnet addresses; do not send mainnet assets.

Once funded:

```sh
FACILITATOR_URL=https://udid-x402-facilitator.ixo-api.workers.dev npm run demo
```

That command transfers 0.10 test USDC to the listed recipient and prints the settlement receipt. Per-payment policy caps the amount at 0.10 test USDC; the tenant's UTC daily reservation budget is 1 test USDC. The request is bound to one offer and the signed decision references the UCAN digest.

If a submission is uncertain, keep `.demo-payment.json` and resume **that exact payment**:

```sh
FACILITATOR_URL=https://udid-x402-facilitator.ixo-api.workers.dev npm run demo -- --resume
```

The Worker retains the original signed transaction for reconciliation. A fresh offer or a second payment must not be used as a substitute for resolving a pending transaction.

Full live settlement remains unverified until those test wallets are funded and the transfer is confirmed. Local tests already cover transaction creation, receipt checks, duplicate settlement and restart recovery with mocked providers; the hosted checks establish deployment and verification behavior separately.
