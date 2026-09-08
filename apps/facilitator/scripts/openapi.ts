import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { offerInputSchema, requestSchema } from '../src/model';

const error = { description: 'Stable error code; no credential or provider error details', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } };
const json = (schema: unknown) => ({ 'application/json': { schema } });
const post = (summary: string, schema: string, response: unknown) => ({
  summary, security: [{ resourceServerKey: [] }],
  requestBody: { required: true, content: json({ $ref: `#/components/schemas/${schema}` }) },
  responses: { '200': { description: 'Protocol result (inspect isValid or success)', content: json(response) }, '400': error, '401': error, '403': error, '409': error, '413': error, '429': error, '503': error },
});
const verification = { type: 'object', required: ['isValid'], properties: { isValid: { type: 'boolean' }, invalidReason: { type: 'string' }, payer: { type: 'string' } } };
const settlement = { type: 'object', required: ['success', 'transaction', 'network'], properties: {
  success: { type: 'boolean' }, transaction: { type: 'string' }, network: { type: 'string' }, payer: { type: 'string' },
  errorReason: { type: 'string' }, extensions: { type: 'object', additionalProperties: true },
} };
const offer = post('Register authoritative offer and return x402 PaymentRequired', 'OfferInput', { type: 'object', required: ['offerId', 'expiresAt', 'paymentRequired'] });
const { '200': created, ...errors } = offer.responses;
const document = {
  openapi: '3.1.0', info: { title: 'UDID x402 Facilitator Reference', version: '0.1.0', description: 'x402 v2 facilitator with authenticated, registered offers. UCAN 0.8.1 and UDID profiles are provisional; stripe-manual-capture is a custom negotiated scheme.' },
  servers: [{ url: 'http://localhost:8787' }],
  paths: {
    '/health': { get: { summary: 'Liveness and configuration readiness, without provider probes', responses: { '200': { description: 'status and configured fields' }, '503': error } } },
    '/supported': { get: { summary: 'Configured x402 kinds, extensions and EVM signers', responses: { '200': { description: 'x402 SupportedResponse' }, '503': error } } },
    '/networks': { get: { summary: 'Alias of /supported', responses: { '200': { description: 'x402 SupportedResponse' } } } },
    '/offers': { post: { ...offer, responses: { '201': created, ...errors } } },
    '/verify': { post: post('Read-only proof and payment verification; does not reserve funds or consume decisions', 'PaymentRequest', verification) },
    '/settle': { post: post('Validate, atomically consume, submit, or reconcile an identical retry', 'PaymentRequest', settlement) },
    '/settlements/{id}': { get: { summary: 'Read a settlement record owned by the authenticated tenant', security: [{ resourceServerKey: [] }],
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{64}$' } }],
      responses: { '200': { description: 'settlementId, offerId, state and optional result; no raw signed transaction' }, '401': error, '404': error, '429': error } } },
  },
  components: { securitySchemes: { resourceServerKey: { type: 'http', scheme: 'bearer' } }, schemas: {
    OfferInput: z.toJSONSchema(offerInputSchema, { io: 'input' }), PaymentRequest: z.toJSONSchema(requestSchema, { io: 'input' }),
  } },
};
await writeFile('openapi.json', `${JSON.stringify(document, null, 2)}\n`);
