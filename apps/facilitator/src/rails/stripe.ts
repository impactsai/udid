import { z } from 'zod';
import type { OperatorConfig } from '../config';
import type { Offer, Payment, PreparedPayment, RailAdapter, Requirements, SettlementResult } from '../model';
import { hashObject, requireThat } from '../util';

const payloadSchema = z.object({ paymentIntentId: z.string().regex(/^pi_[a-zA-Z0-9]+$/), customerId: z.string().regex(/^cus_[a-zA-Z0-9]+$/) }).strict();
const intentSchema = z.object({
  id: z.string(), object: z.literal('payment_intent'), amount: z.number().int(), currency: z.string(),
  amount_capturable: z.number().int(), amount_received: z.number().int(), status: z.string(),
  capture_method: z.string(), livemode: z.boolean(), customer: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
});
type Intent = z.infer<typeof intentSchema>;

/** Private, negotiated x402 scheme. This is not Stripe's x402/machine-payments preview. */
export class StripeRail implements RailAdapter {
  constructor(private config: NonNullable<OperatorConfig['stripe']>, private secret: string, private fetcher: typeof fetch = fetch.bind(globalThis)) {}
  payer(payment: Payment) { return payloadSchema.parse(payment.payload).customerId; }
  async paymentKey(payment: Payment) { return hashObject([this.config.network, this.config.account, payloadSchema.parse(payment.payload).paymentIntentId]); }
  private async request(path: string, method = 'GET', form?: URLSearchParams, idempotencyKey?: string): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.secret}`, 'Stripe-Account': this.config.account };
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await this.fetcher(`https://api.stripe.com/v1/${path}`, { method, headers, body: form, signal: AbortSignal.timeout(8000) });
    requireThat(response.ok, 'stripe_unavailable', 503);
    return response.json();
  }
  private async intent(id: string) { return intentSchema.parse(await this.request(`payment_intents/${id}`)); }
  private matches(intent: Intent, r: Requirements) {
    return intent.livemode === (this.config.network === 'stripe:live')
      && r.network === this.config.network && r.payTo === this.config.account
      && intent.amount.toString() === r.amount && intent.currency === r.asset;
  }
  async verify(payment: Payment, requirements: Requirements, offer: Offer) {
    const { paymentIntentId: id, customerId } = payloadSchema.parse(payment.payload);
    const intent = await this.intent(id);
    requireThat(intent.id === id && intent.customer === customerId && this.matches(intent, requirements), 'stripe_binding_mismatch', 403);
    requireThat(intent.metadata.x402_offer_id === offer.id
      && intent.metadata.x402_binding_digest === offer.bindingDigest
      && intent.metadata.x402_resource === offer.resource.url, 'stripe_offer_mismatch', 403);
    requireThat(intent.capture_method === 'manual' && intent.status === 'requires_capture'
      && intent.amount_capturable.toString() === requirements.amount, 'stripe_not_authorized', 403);
    // This is a processor customer reference, never an independently verified human identity.
    return { isValid: true, payer: customerId };
  }
  async prepare(payment: Payment): Promise<PreparedPayment> { return { transaction: payloadSchema.parse(payment.payload).paymentIntentId }; }
  async submit(prepared: PreparedPayment, requirements: Requirements, payer: string): Promise<SettlementResult> {
    const base = { transaction: prepared.transaction, network: requirements.network, payer };
    try {
      let intent = await this.intent(prepared.transaction);
      if (!this.matches(intent, requirements) || intent.customer !== payer) return { ...base, success: false, errorReason: 'stripe_binding_mismatch' };
      if (intent.status === 'requires_capture') {
        requireThat(intent.amount_capturable.toString() === requirements.amount, 'stripe_amount_mismatch');
        intent = intentSchema.parse(await this.request(`payment_intents/${prepared.transaction}/capture`, 'POST',
          new URLSearchParams({ amount_to_capture: requirements.amount }),
          `x402-${(await hashObject([this.config.account, prepared.transaction])).slice(7)}`));
      }
      if (!this.matches(intent, requirements) || intent.id !== prepared.transaction || intent.customer !== payer) return { ...base, success: false, errorReason: 'stripe_binding_mismatch' };
      if (intent.status === 'succeeded' && intent.amount_received.toString() === requirements.amount) return { ...base, success: true };
      if (['canceled', 'requires_payment_method'].includes(intent.status)) return { ...base, success: false, errorReason: 'stripe_payment_failed' };
      return { ...base, success: false, errorReason: 'settlement_pending' };
    } catch { return { ...base, success: false, errorReason: 'settlement_pending' }; }
  }
}
