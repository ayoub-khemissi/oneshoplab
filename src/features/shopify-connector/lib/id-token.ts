// The verifier lives in the shop-connection entity: `auth()` needs it too.
export {
  bearerFrom,
  signShopifyIdTokenForTests,
  verifyShopifyIdToken,
  type ShopifyIdToken
} from '@/entities/shop-connection';
