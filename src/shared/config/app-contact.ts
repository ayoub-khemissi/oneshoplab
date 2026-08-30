/**
 * The ONE public contact address of the app. Surfaces in the legal pages,
 * the unsubscribe page, the Organization schema, the contact-form inbox
 * and as Reply-To on outgoing mail — read from APP_CONTACT_EMAIL so a
 * mailbox change is a .env edit, not a grep across the codebase.
 *
 * Note: the SMTP *envelope* sender stays SMTP_FROM_EMAIL (it must be a
 * domain the relay is authenticated for — SPF/DKIM alignment); this
 * address is where humans should write, hence Reply-To.
 */
export function getAppContactEmail(): string {
  return process.env.APP_CONTACT_EMAIL?.trim() || 'contact@get-oneshoplab.com';
}
