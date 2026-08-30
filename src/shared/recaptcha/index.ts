// Server entry: `RecaptchaLegalNotice` uses next-intl/server, so client
// components import the widget from `@/shared/recaptcha/client` instead.
export { isRecaptchaEnabled, verifyRecaptcha } from './verify';
export type { RecaptchaResult } from './verify';
export { RecaptchaLegalNotice } from './ui/recaptcha-legal-notice';
export { RecaptchaWrapper } from './ui/recaptcha-wrapper';
