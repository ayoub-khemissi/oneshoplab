export {
  REFERRAL_COOKIE,
  REFERRAL_PARAMS,
  REFERRAL_TTL_DAYS,
  normalizeRefId,
  refFromSearchParams
} from './lib/ref';
export {
  REFERRAL_COOKIE_MAX_AGE,
  isReferralTrackingConfigured,
  trackReferralSignup
} from './api/first-promoter';
export type { TrackSignupInput, TrackSignupResult } from './api/first-promoter';
