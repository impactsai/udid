import { z } from 'zod';

export const UDID = 'org.udid.decision@1';
export const UCAN = 'org.ucan.authorization@1';
export const atomicAmount = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
export const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const requirementsSchema = z.object({
  scheme: z.enum(['exact', 'stripe-manual-capture']),
  network: z.string().regex(/^[a-z0-9]+:[A-Za-z0-9._-]+$/),
  amount: atomicAmount,
  asset: z.string().min(1).max(128),
  payTo: z.string().min(1).max(128),
  maxTimeoutSeconds: z.number().int().min(10).max(300),
  extra: z.record(z.string(), z.unknown()).default({}),
}).strict();
export const resourceSchema = z.object({
  url: z.url().max(2048),
  description: z.string().max(500).optional(),
  mimeType: z.string().max(100).optional(),
}).strict();
export const paymentSchema = z.object({
  x402Version: z.literal(2),
  accepted: requirementsSchema,
  resource: resourceSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
  extensions: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const requestSchema = z.object({
  x402Version: z.literal(2),
  offerId: z.string().uuid(),
  paymentRequirements: requirementsSchema,
  paymentPayload: paymentSchema,
}).strict();
export const offerInputSchema = z.object({
  resource: resourceSchema,
  paymentRequirements: requirementsSchema,
  requireUcan: z.boolean().optional(),
  requireUdid: z.boolean().optional(),
}).strict();
export type Requirements = z.infer<typeof requirementsSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentRequest = z.infer<typeof requestSchema>;
export type OfferInput = z.infer<typeof offerInputSchema>;
export interface Offer {
  id: string;
  tenantId: string;
  createdAt: number;
  expiresAt: number;
  resource: z.infer<typeof resourceSchema>;
  requirements: Requirements;
  bindingDigest: string;
  capability: { with: { scheme: string; hierPart: string }; can: { namespace: string; segments: string[] } };
  requireUcan: boolean;
  requireUdid: boolean;
  holderBinding: 'none' | 'did-authentication';
}
export interface ProofResult {
  ucan: 'verified' | 'not_requested';
  udid: 'verified' | 'not_requested';
  authorityDigest?: string;
  decision?: { issuer: string; id: string; offerId: string; replayKey: string };
}
export interface VerifyResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
}
export interface SettlementResult {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
  extensions?: Record<string, unknown>;
}
export interface PreparedPayment {
  transaction: string;
  rawTransaction?: `0x${string}`;
  nonce?: number;
}
export interface SettlementRecord {
  id: string;
  fingerprint: string;
  tenantId: string;
  offerId: string;
  payer: string;
  network: string;
  createdAt: number;
  proof: ProofResult;
  state: 'reserved' | 'prepared' | 'settled' | 'failed';
  prepared?: PreparedPayment;
  result?: SettlementResult;
}
export interface RailAdapter {
  payer(payment: Payment): string;
  paymentKey(payment: Payment): Promise<string>;
  verify(payment: Payment, requirements: Requirements, offer: Offer): Promise<VerifyResult>;
  prepare(payment: Payment, requirements: Requirements, nonceFloor?: number): Promise<PreparedPayment>;
  submit(prepared: PreparedPayment, requirements: Requirements, payer: string): Promise<SettlementResult>;
}
export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T>;
}
