import { offerInputSchema, requestSchema, type OfferInput, type Payment, type SettlementResult, type VerifyResult } from './model';
import { advertise } from './offers';
import { decodeHeader, encodeHeader, requireThat } from './util';

export type RegisteredOffer = ReturnType<typeof advertise>;
/** Resource-server client. Its API key must never be shipped to a browser or payer agent. */
export class FacilitatorClient {
  constructor(private url: string, private apiKey: string, private fetcher: typeof fetch = fetch.bind(globalThis)) {}
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.url.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    requireThat(response.ok, `facilitator_http_${response.status}`, response.status);
    return response.json() as Promise<T>;
  }
  createOffer(input: OfferInput) { return this.post<RegisteredOffer>('/offers', offerInputSchema.parse(input)); }
  verify(offer: RegisteredOffer, payment: Payment) {
    return this.post<VerifyResult>('/verify', this.body(offer, payment));
  }
  async settle(offer: RegisteredOffer, payment: Payment): Promise<SettlementResult> {
    const body = this.body(offer, payment);
    let result = await this.post<SettlementResult>('/settle', body);
    if (!result.success && result.errorReason === 'settlement_pending') result = await this.post<SettlementResult>('/settle', body);
    return result;
  }
  private body(offer: RegisteredOffer, payment: Payment) {
    return requestSchema.parse({ x402Version: 2, offerId: offer.offerId, paymentRequirements: offer.paymentRequired.accepts[0], paymentPayload: payment });
  }
}
export { decodeHeader, encodeHeader };
