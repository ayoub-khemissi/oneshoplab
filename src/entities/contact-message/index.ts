export { contactSchema } from './model/schema';
export type {
  ContactContext,
  ContactErrorCode,
  ContactInput,
  SubmitContactResult
} from './model/schema';
export { isContactRateLimited, submitContactMessage } from './api/submit';
