import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url)));
const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const digest = (value) => `sha256:${createHash('sha256').update(canonicalize(value)).digest('hex')}`;

function verifyBinding(offer, credential) {
  const extension = offer.extensions['org.udid.decision@1'];
  const accepted = offer.accepts[0];
  const decision = credential.credentialSubject.decision;
  assert.equal(extension.version, '1');
  assert.equal(extension.required, true);
  assert.ok(credential.type.includes('DecisionCredential'));
  assert.ok(credential.type.includes('DecisionToPayCredential'));
  assert.equal(decision.type, 'decision_to_pay');
  assert.equal(decision.outcome, 'approved');
  assert.equal(extension.bindingDigest, digest(accepted));
  assert.equal(decision.binding.offerId, extension.offerId);
  assert.equal(decision.binding.bindingDigest, extension.bindingDigest);
  assert.equal(decision.binding.resource, offer.resource.url);
  for (const field of ['network', 'asset', 'payTo', 'amount']) {
    assert.equal(decision.binding[field], accepted[field]);
  }
}

test('the advertised x402 offer and UDID credential bind exactly', () => {
  verifyBinding(read('payment-required.json'), read('decision-credential.json'));
});

for (const [name, mutate] of [
  ['declined outcome', (c) => { c.credentialSubject.decision.outcome = 'declined'; }],
  ['different offer', (c) => { c.credentialSubject.decision.binding.offerId = 'urn:uuid:other'; }],
  ['different resource', (c) => { c.credentialSubject.decision.binding.resource = 'https://attacker.example.test'; }],
  ['different network', (c) => { c.credentialSubject.decision.binding.network = 'eip155:1'; }],
  ['different asset', (c) => { c.credentialSubject.decision.binding.asset = '0x0000000000000000000000000000000000000000'; }],
  ['different payee', (c) => { c.credentialSubject.decision.binding.payTo = '0x0000000000000000000000000000000000000000'; }],
  ['different amount', (c) => { c.credentialSubject.decision.binding.amount = '100001'; }],
  ['different binding digest', (c) => { c.credentialSubject.decision.binding.bindingDigest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'; }]
]) {
  test(`rejects ${name}`, () => {
    const offer = read('payment-required.json');
    const credential = structuredClone(read('decision-credential.json'));
    mutate(credential);
    assert.throws(() => verifyBinding(offer, credential));
  });
}

test('payload keeps the decision presentation in the x402 extension', () => {
  const payload = read('payment-payload.json');
  assert.equal(payload.x402Version, 2);
  assert.equal(payload.extensions['org.udid.decision@1'].format, 'jwt_vp_json');
  assert.ok(payload.extensions['org.udid.decision@1'].presentation.startsWith('EXAMPLE ONLY'));
});
