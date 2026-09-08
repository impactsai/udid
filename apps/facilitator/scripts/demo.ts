import { readFile, writeFile } from 'node:fs/promises';
import { FacilitatorClient, encodeHeader } from '../src/client';
import type { Payment } from '../src/model';
import { createDemoPayment, loadDemo } from './demo-payment';

const demo = await loadDemo();
const client = new FacilitatorClient(process.env.FACILITATOR_URL ?? 'http://localhost:8787', demo.apiKey);
const resume = process.argv.includes('--resume');
let offer: Awaited<ReturnType<typeof client.createOffer>>, payment: Payment;
if (resume) ({ offer, payment } = JSON.parse(await readFile('.demo-payment.json', 'utf8')));
else {
  ({ offer, payment } = await createDemoPayment(client, demo));
  console.log('402 Payment Required', { 'PAYMENT-REQUIRED': encodeHeader(offer.paymentRequired) });
  const verified = await client.verify(offer, payment);
  console.log('Verification:', verified);
  if (!verified.isValid) process.exit(1);
  await writeFile('.demo-payment.json', JSON.stringify({ offer, payment }), { mode: 0o600 });
}
const receipt = await client.settle(offer, payment);
console.log('Settlement:', receipt);
if (receipt.success) console.log('200 OK', { 'PAYMENT-RESPONSE': encodeHeader(receipt) }, { weather: 'Demo report; no external weather data was fetched.' });
else { console.log('No resource returned. Resume this exact payment with npm run demo -- --resume.'); process.exitCode = 1; }
