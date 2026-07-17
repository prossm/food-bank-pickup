/**
 * Identifies a web tester the way a phone number identifies an SMS sender.
 *
 * Deliberately not authentication — it's the web transport's stand-in for "which phone is
 * this", so each browser gets its own thread and testers don't stomp on each other. The
 * value is minted and read in the chat route, which has the Request in hand.
 */
export const SESSION_COOKIE = 'fb_thread';
