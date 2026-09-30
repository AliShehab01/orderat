// The public shop page's "Sold out" rules (docs/marketing-tools.md, soldOut). A product is sold out when
// the seller tracks its stock and it is at 0 or below; the phones publish only the flag. It stays on the
// page, greyed, and cannot be ordered. A cart saved before it sold out, or a page opened before, still
// holds it: the checkout takes it out and says so, before sending or on the server's 409 sold_out.
// Loaded before shop.js (window.OrderatSoldOut) and by web/shop-sold-out.test.js.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrderatSoldOut = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function isSoldOut(item) {
    return !!item && item.soldOut === true;
  }

  // The product ids of a 409 { error: "sold_out", productIds } answer, else null.
  function refusedIds(status, data) {
    if (status !== 409 || !data || data.error !== "sold_out" || !Array.isArray(data.productIds)) return null;
    return data.productIds.filter(function (id) { return typeof id === "string" && id; });
  }

  // Takes products out of the cart ({ id: qty }): the ids the server refused, or (ids null) every
  // product in it that is sold out. The refused ones are marked sold out on the page's own copy of
  // the shop too, so their cards grey out. Returns the items taken out, in cart order.
  function takeOut(cart, items, ids) {
    var byId = {};
    (items || []).forEach(function (item) { if (item && typeof item.id === "string") byId[item.id] = item; });
    var removed = [];
    Object.keys(cart).forEach(function (id) {
      var item = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
      if (ids ? ids.indexOf(id) < 0 : !isSoldOut(item)) return;
      delete cart[id];
      if (item) { item.soldOut = true; removed.push(item); }
    });
    return removed;
  }

  return { isSoldOut: isSoldOut, refusedIds: refusedIds, takeOut: takeOut };
});
