(function(global){
  'use strict';

  function isSaleVoided(sale) {
    return Boolean(sale?.voided || sale?.status === 'voided');
  }

  function getVisibleSalesForHistory(sales) {
    return (sales || []).filter(sale => !isSaleVoided(sale));
  }

  function buildCategorySalesBreakdown(sales, products, categories) {
    const byCategory = {};

    categories.forEach(category => {
      byCategory[category] = {
        category,
        totalQty: 0,
        totalRevenue: 0,
        items: [],
      };
    });

    const productMap = new Map(products.map(product => [Number(product.id), product]));

    sales.forEach(sale => {
      (sale.items || []).forEach(item => {
        const productId = Number(item.productId || 0);
        const product = productMap.get(productId);
        if (!product) return;
        const bucket = byCategory[product.category];
        if (!bucket) return;

        const qty = Number(item.qty || 0);
        const revenue = Number(item.price || 0) * qty;
        bucket.totalQty += qty;
        bucket.totalRevenue += revenue;

        const existing = bucket.items.find(entry => entry.id === productId);
        if (existing) {
          existing.qty += qty;
          existing.revenue += revenue;
        } else {
          bucket.items.push({
            id: productId,
            name: product.name,
            qty,
            revenue,
          });
        }
      });
    });

    Object.values(byCategory).forEach(bucket => {
      bucket.items.sort((a, b) => b.revenue - a.revenue || b.qty - a.qty);
    });

    return byCategory;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildCategorySalesBreakdown, getVisibleSalesForHistory, isSaleVoided };
  }

  global.buildCategorySalesBreakdown = buildCategorySalesBreakdown;
  global.getVisibleSalesForHistory = getVisibleSalesForHistory;
  global.isSaleVoided = isSaleVoided;
})(typeof globalThis !== 'undefined' ? globalThis : this);
