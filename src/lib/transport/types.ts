/**
 * The transport boundary.
 *
 * v1 has exactly one implementation (the web chat), but everything above this line is written
 * as if messages arrive over SMS — an address, a body, and nothing else. Adding Twilio means
 * adding a route that maps `From`/`Body` onto this shape and calls processInbound. No
 * conversation code changes.
 */
export interface Address {
  channel: 'web' | 'sms' | 'whatsapp';
  /** Cookie id on the web; the E.164 phone number over SMS/WhatsApp. */
  externalId: string;
}

export interface InboundMessage {
  address: Address;
  text: string;
}

export interface OutboundMessage {
  body: string;
}
