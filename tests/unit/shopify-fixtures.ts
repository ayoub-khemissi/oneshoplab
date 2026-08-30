/** Hand-written after the Admin GraphQL 2025-07 Product / ProductVariant / MediaImage shapes. */
import type { AdminProduct } from '@/features/shopify-connector';

export const adminProductFixture: AdminProduct = {
  id: 'gid://shopify/Product/8123456789012',
  title: 'Linen shirt',
  handle: 'linen-shirt',
  descriptionHtml: '<p>Breathable <strong>linen</strong> shirt.</p>',
  vendor: 'Atelier',
  productType: 'Shirts',
  tags: ['summer', ' linen ', ''],
  updatedAt: '2026-08-29T10:15:00Z',
  onlineStoreUrl: 'https://atelier.example/products/linen-shirt',
  variants: {
    nodes: [
      {
        id: 'gid://shopify/ProductVariant/45000000000001',
        title: 'S / White',
        sku: 'LS-S-W',
        price: '49.90',
        availableForSale: true,
        selectedOptions: [
          { name: 'Size', value: 'S' },
          { name: 'Color', value: 'White' }
        ]
      },
      {
        id: 'gid://shopify/ProductVariant/45000000000002',
        title: 'M / White',
        sku: '',
        price: '54.00',
        availableForSale: false,
        selectedOptions: [
          { name: 'Size', value: 'M' },
          { name: 'Color', value: 'White' }
        ]
      }
    ]
  },
  media: {
    nodes: [
      {
        id: 'gid://shopify/MediaImage/31000000000001',
        alt: 'Front view',
        image: {
          url: 'https://cdn.shopify.com/s/files/1/0001/front.jpg',
          width: 1200,
          height: 1600
        }
      },
      // A Video node in the same connection: the inline fragment yields {}.
      {},
      {
        id: 'gid://shopify/MediaImage/31000000000002',
        alt: null,
        image: { url: 'https://cdn.shopify.com/s/files/1/0001/back.jpg', width: null, height: null }
      }
    ]
  }
};

export function singleVariantFixture(): AdminProduct {
  return {
    ...adminProductFixture,
    id: 'gid://shopify/Product/1',
    handle: 'plain',
    onlineStoreUrl: null,
    variants: {
      nodes: [
        {
          id: 'gid://shopify/ProductVariant/9',
          title: 'Default Title',
          sku: null,
          price: '0.00',
          availableForSale: true,
          selectedOptions: [{ name: 'Title', value: 'Default Title' }]
        }
      ]
    },
    media: { nodes: [] }
  };
}
