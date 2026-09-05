/** What a device is told to show. Mirrors the shape `sw.js` reads. */
export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap lands — an absolute URL, so the worker can compare origins. */
  url?: string;
  /** Same tag replaces the previous notice instead of stacking a second one. */
  tag?: string;
  /** Shown as the notification's icon. The product's own photo when there is
   *  one: on a lock screen a merchant recognises their product long before
   *  they read the title. Falls back to the app icon in `sw.js`. */
  icon?: string;
}

/** A browser subscription, as `PushManager.subscribe` returns it. */
export interface SaveSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}
