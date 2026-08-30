export type {
  AgencyColdVars,
  ColdLang,
  ColdTouch,
  ColdVariant,
  ColdVars,
  MerchantColdVars
} from './lib/templates';
export { getTemplate, platformDisplayName } from './lib/templates';
export type { RenderedColdMail, ScoreSnapshot } from './lib/render';
export { agencyNameFromDomain, firstNameFromEmail, renderColdMail } from './lib/render';
export { makeOptOutToken, verifyOptOutToken } from './lib/opt-out';
export type { SendColdMailOptions, SendColdMailResult } from './api/mailer';
export { sendColdMail } from './api/mailer';
export type { FreshAuditInfo, LeadOutreach } from './api/lead-outreach';
export { buildLeadOutreach, freshAuditsByDomain } from './api/lead-outreach';
export type { ContactCopy, ContactLang, ContactVariant, ContactVars } from './api/contact-form';
export { CONTACT_LANGS, buildContactCopy, pickContactLang } from './api/contact-form';
