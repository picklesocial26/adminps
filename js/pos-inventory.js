(function (global) {
  'use strict';

  function applyInventoryDeduction(products, cart) {
    const affectedProducts = [];

    if (!Array.isArray(products) || !Array.isArray(cart)) {
      return affectedProducts;
    }

    cart.forEach((item) => {
      const qty = Number(item && item.qty ? item.qty : 0);
      if (!Number.isFinite(qty) || qty <= 0) return;

      const productId = Number(item && item.productId != null ? item.productId : 0);
      if (!Number.isFinite(productId) || productId <= 0) return;

      const product = products.find((entry) => Number(entry && entry.id) === productId);
      if (!product || product.category === 'Rent' || product.isRent) return;

      const nextStock = Math.max(0, Number(product.stock || 0) - qty);
      product.stock = nextStock;
      affectedProducts.push(product);
    });

    return affectedProducts;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { applyInventoryDeduction };
  }

  global.applyInventoryDeduction = applyInventoryDeduction;
})(typeof window !== 'undefined' ? window : globalThis);
