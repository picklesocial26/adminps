(function(){
  "use strict";

  /* ---------------- Data (Supabase-backed with local fallback) ---------------- */
  const CATS = {
    "Beverages":"#D6336C", "Snacks":"#E8598E", "Rent":"#C2255C"
  };

  const DEFAULT_PRODUCTS = [];

  const isRentProduct = p => p.category === "Rent";

  let cart = [];          // {productId, qty}
  let sales = [];         // completed transactions
  let products = [];
  let stockLogs = [];
  let saleCounter = 1024;
  let activeCategory = "All";
  let payMethod = "cash";
  let productSalesDay = "today";
  let supabaseClient = null;
  let hasSupabaseData = false;

  /* ---------------- Helpers ---------------- */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const money = n => "₱" + n.toFixed(2);
  const initials = name => name.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();

  function normalizeProduct(item){
    return {
      id: Number(item.id || 0),
      name: item.name || "Unnamed product",
      sku: item.sku || "",
      category: item.category || "Beverages",
      price: Number(item.price || 0),
      cost: Number(item.cost || 0),
      stock: Number(item.stock || 0),
      threshold: Number(item.threshold || 10),
    };
  }

  function normalizeSale(item){
    return {
      id: Number(item.id || 0),
      time: item.time ? (typeof item.time === "string" ? new Date(item.time) : new Date(item.time)) : new Date(),
      items: Array.isArray(item.items) ? item.items : [],
      subtotal: Number(item.subtotal || 0),
      tax: Number(item.tax || 0),
      total: Number(item.total || 0),
      payment: item.payment || "cash",
      tendered: Number(item.tendered || 0),
      change: Number(item.change || 0),
      cashier: item.cashier || "Pickle Social",
    };
  }

  function normalizeStockLog(item){
    return {
      id: Number(item.id || 0),
      product_id: Number(item.product_id || 0),
      product_name: item.product_name || "Product",
      previous_stock: Number(item.previous_stock || 0),
      added_stock: Number(item.added_stock || 0),
      new_stock: Number(item.new_stock || 0),
      note: item.note || "",
      created_at: item.created_at || new Date().toISOString(),
    };
  }

  function saveLocalData(){
    try {
      localStorage.setItem("countr-pos-products", JSON.stringify(products));
      localStorage.setItem("countr-pos-sales", JSON.stringify(sales.map(s=>({
        ...s,
        time: s.time instanceof Date ? s.time.toISOString() : s.time,
      }))));
      localStorage.setItem("countr-pos-stock-logs", JSON.stringify(stockLogs));
    } catch (err) {
      console.warn("Unable to save POS data locally", err);
    }
  }

  async function getSupabaseClient(){
    if (supabaseClient) return supabaseClient;
    const config = window.SUPABASE_CONFIG || {};
    const url = config.url || "https://nozisfmqzkeywefrqkok.supabase.co";
    const anonKey = config.anonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5vemlzZm1xemtleXdlZnJxa29rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzY2NzcsImV4cCI6MjA5NDE1MjY3N30.9CyqA4zZ9o5glyVl40Baah9ce-mqPIB3fAi2wp2-Ppk";
    if (!window.supabase || !url || !anonKey) return null;
    supabaseClient = window.supabase.createClient(url, anonKey);
    return supabaseClient;
  }

  async function loadPosData(){
    try {
      const storedProducts = localStorage.getItem("countr-pos-products");
      const storedSales = localStorage.getItem("countr-pos-sales");
      const storedLogs = localStorage.getItem("countr-pos-stock-logs");
      if (storedProducts) {
        try { products = JSON.parse(storedProducts).map(normalizeProduct); } catch (err) { console.warn("Failed to parse saved products", err); }
      }
      if (storedSales) {
        try { sales = JSON.parse(storedSales).map(normalizeSale); } catch (err) { console.warn("Failed to parse saved sales", err); }
      }
      if (storedLogs) {
        try { stockLogs = JSON.parse(storedLogs).map(normalizeStockLog); } catch (err) { console.warn("Failed to parse saved stock logs", err); }
      }
    } catch (err) {
      console.warn("Local storage unavailable", err);
    }

    const client = await getSupabaseClient();
    if (!client) {
      saleCounter = Math.max(1024, sales.reduce((max, sale) => Math.max(max, Number(sale.id || 0)), 1024) + 1);
      saveLocalData();
      return;
    }

    try {
      const { data: remoteProducts, error: productError } = await client.from("pos_products").select("*").order("id", { ascending: true });
      if (!productError && Array.isArray(remoteProducts)) {
        products = remoteProducts.map(normalizeProduct);
        hasSupabaseData = true;
      }

      const { data: remoteSales, error: salesError } = await client.from("pos_sales").select("*").order("created_at", { ascending: false });
      if (!salesError && Array.isArray(remoteSales)) {
        sales = remoteSales.map(normalizeSale);
        hasSupabaseData = true;
      }

      const { data: remoteLogs, error: logError } = await client.from("pos_stock_logs").select("*").order("created_at", { ascending: false });
      if (!logError && Array.isArray(remoteLogs)) {
        stockLogs = remoteLogs.map(normalizeStockLog);
      }
    } catch (err) {
      console.warn("Supabase POS sync unavailable, using local data", err);
    }

    if (!products.length && !sales.length) {
      products = [];
      sales = [];
    }
    saleCounter = Math.max(1024, sales.reduce((max, sale) => Math.max(max, Number(sale.id || 0)), 1024) + 1);
    saveLocalData();
  }

  async function syncPosData(){
    const client = await getSupabaseClient();
    if (!client) return;
    try {
      await client.from("pos_products").upsert(products.map(p=>({ id: p.id, name: p.name, sku: p.sku, category: p.category, price: p.price, cost: p.cost, stock: p.stock, threshold: p.threshold })), { onConflict: "id" });
      for (const sale of sales) {
        await client.from("pos_sales").upsert([{
          id: sale.id,
          created_at: sale.time instanceof Date ? sale.time.toISOString() : sale.time,
          items: sale.items,
          subtotal: sale.subtotal,
          tax: sale.tax,
          total: sale.total,
          payment: sale.payment,
          tendered: sale.tendered,
          change: sale.change,
          cashier: sale.cashier,
        }], { onConflict: "id" });
      }
    } catch (err) {
      console.warn("Supabase sync failed", err);
    }
  }

  async function deleteSaleRemote(saleId){
    const client = await getSupabaseClient();
    if (!client) return;
    try {
      await client.from("pos_sales").delete().eq("id", saleId);
    } catch (err) {
      console.warn("Unable to delete sale from Supabase", err);
    }
  }

  async function deleteProductRemote(productId){
    const client = await getSupabaseClient();
    if (!client) return;
    try {
      await client.from("pos_products").delete().eq("id", productId);
    } catch (err) {
      console.warn("Unable to delete product from Supabase", err);
    }
  }

  function createStockLogEntry(product, qty, note) {
    const entry = {
      id: Date.now(),
      product_id: product.id,
      product_name: product.name,
      previous_stock: product.stock,
      added_stock: qty,
      new_stock: product.stock + qty,
      note,
      created_at: new Date().toISOString(),
    };
    stockLogs.unshift(entry);
    return entry;
  }

  async function voidLastSale(saleId){
    const saleIndex = sales.findIndex(s => s.id === saleId);
    if (saleIndex === -1) {
      toast("No sale found to void");
      return;
    }
    const sale = sales[saleIndex];
    if (!confirm(`Void sale #${sale.id}? This will return items to stock.`)) return;

    sales.splice(saleIndex, 1);
    sale.items.forEach(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) return;
      const previousStock = product.stock;
      product.stock += Number(item.qty || 0);
      const logEntry = createStockLogEntry(product, Number(item.qty || 0), `Voided sale #${sale.id}`);
      product.stock = logEntry.new_stock;
    });

    renderCart();
    renderInventory();
    renderDashboard();
    renderProducts();
    renderSales();
    toast(`Sale #${sale.id} voided`, false);
    saveLocalData();
    await deleteSaleRemote(sale.id);
    try {
      await syncPosData();
    } catch (err) {
      console.warn("Unable to sync voided sale to Supabase", err);
    }
  }

  function toast(msg, ok=false){
    const wrap = $("#toastWrap");
    const el = document.createElement("div");
    el.className = "toast" + (ok ? " ok":"");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(()=> el.remove(), 2600);
  }

  /* ---------------- Navigation ---------------- */
  const viewMeta = {
    dashboard:{title:"Dashboard", sub:"Today's performance at a glance"},
    pos:{title:"Point of Sale", sub:"Build the order, then take payment"},
    inventory:{title:"Inventory", sub:"Manage stock, pricing and product details"},
    sales:{title:"Sales History", sub:"Every completed transaction"},
  };

  const requestedView = (new URLSearchParams(window.location.search).get("view") || "pos").toLowerCase();
  const initialView = Object.prototype.hasOwnProperty.call(viewMeta, requestedView) ? requestedView : "pos";

  function showView(name){
    Object.keys(viewMeta).forEach(v=>{
      $("#view-"+v).hidden = (v!==name);
    });
    $$(".nav-item").forEach(b=> b.classList.toggle("active", b.dataset.view===name));
    $("#viewTitle").textContent = viewMeta[name].title;
    $("#viewSub").textContent = viewMeta[name].sub;
    $("#sidebar").classList.remove("open");
    if(name==="dashboard") renderDashboard();
    if(name==="inventory") renderInventory();
    if(name==="sales") renderSales();
    if(name==="pos") renderProducts();
  }
  $("#nav").addEventListener("click", e=>{
    const btn = e.target.closest(".nav-item");
    if(btn) showView(btn.dataset.view);
  });
  $("#menuBtn").addEventListener("click", ()=> $("#sidebar").classList.toggle("open"));
  $("#closeSidebarBtn").addEventListener("click", ()=> $("#sidebar").classList.remove("open"));

  /* ---------------- Clock ---------------- */
  function tickClock(){
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"});
  }
  setInterval(tickClock, 1000); tickClock();

  /* ---------------- Dashboard ---------------- */
  function renderDashboard(){
    const total = sales.reduce((s,t)=>s+t.total,0);
    const units = sales.reduce((s,t)=> s + t.items.reduce((a,i)=>a+i.qty,0), 0);
    const avg = sales.length ? total/sales.length : 0;
    $("#statSales").textContent = money(total);
    $("#statSalesSub").textContent = sales.length + (sales.length===1 ? " transaction":" transactions");
    $("#statAvg").textContent = money(avg);
    $("#statUnits").textContent = units;
    const low = products.filter(p=> !isRentProduct(p) && p.stock<=p.threshold);
    $("#statLow").textContent = low.length;

    // category chart
    const byCat = {};
    sales.forEach(t=> t.items.forEach(i=>{
      const p = products.find(pp=>pp.id===i.productId);
      if(!p) return;
      byCat[p.category] = (byCat[p.category]||0) + i.qty*i.price;
    }));
    const max = Math.max(1, ...Object.values(byCat));
    const catHtml = Object.keys(CATS).map(c=>{
      const val = byCat[c]||0;
      const pct = Math.round((val/max)*100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="width:110px;font-size:12px;color:var(--ink-soft);flex-shrink:0;">${c}</div>
        <div style="flex:1;background:var(--paper);border-radius:99px;height:9px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${CATS[c]};border-radius:99px;"></div>
        </div>
        <div style="width:64px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;flex-shrink:0;">${money(val)}</div>
      </div>`;
    }).join("");
    $("#catChart").innerHTML = sales.length ? catHtml : `<div class="empty" style="padding:20px 0;"><p>No sales recorded today yet — head to Point of Sale to ring up an order.</p></div>`;

    // low stock list
    if(low.length===0){
      $("#lowStockList").innerHTML = `<div class="empty" style="padding:24px 20px;"><p>All products are well stocked.</p></div>`;
    } else {
      $("#lowStockList").innerHTML = low.slice(0,6).map(p=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:11px 18px;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:13px;font-weight:600;">${p.name}</div>
            <div style="font-size:11px;color:var(--ink-soft);" class="mono">${p.sku}</div>
          </div>
          <span class="badge ${p.stock===0?'badge-bad':'badge-warn'}"><i class="badge-dot"></i>${p.stock} left</span>
        </div>`).join("");
    }

    // quantity sold and revenue per product for the selected day
    const salesRefDate = new Date();
    if (productSalesDay === "yesterday") salesRefDate.setDate(salesRefDate.getDate() - 1);
    const dayLabel = productSalesDay === "yesterday" ? "yesterday" : "today";
    $("#productSalesTitle").textContent = dayLabel;
    const dailySales = sales.filter(t => new Date(t.time).toDateString() === salesRefDate.toDateString());
    const productSales = {};
    dailySales.forEach(t=>{
      t.items.forEach(i=>{
        const productId = Number(i.productId || 0);
        const product = products.find(pp=>pp.id===productId);
        const label = product?.name || i.name || i.sku || `Product ${productId || "?"}`;
        const qty = Number(i.qty || 0);
        const revenue = Number(i.price || 0) * qty;
        if (!productSales[productId]) {
          productSales[productId] = { label, qty: 0, revenue: 0, stock: product?.stock ?? 0 };
        }
        productSales[productId].qty += qty;
        productSales[productId].revenue += revenue;
        productSales[productId].stock = product?.stock ?? productSales[productId].stock;
      });
    });
    const totalEarnedToday = dailySales.reduce((sum,t)=> sum + Number(t.total || 0), 0);

    if (!Object.keys(productSales).length) {
      const message = productSalesDay === "yesterday" ? "No products sold yesterday." : "No products sold today yet.";
      $("#productSalesList").innerHTML = `<div class="empty" style="padding:24px 20px;"><p>${message}</p></div>`;
    } else {
      const productSalesHtml = Object.values(productSales)
        .sort((a,b)=>b.revenue - a.revenue)
        .map(data=>`
          <div style="display:grid;grid-template-columns:1.8fr 0.8fr 0.9fr 1fr;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="font-size:13px;"><strong>${data.label}</strong></div>
            <div class="mono" style="font-size:13px;text-align:right;">${data.qty} qty</div>
            <div class="mono" style="font-size:13px;text-align:right;">${data.stock} left</div>
            <div class="mono" style="font-size:13px;text-align:right;">${money(data.revenue)}</div>
          </div>`)
        .join("");

      $("#productSalesList").innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:12px;font-size:13px;font-weight:700;">
          <div>Total overall earned</div>
          <div class="mono">${money(totalEarnedToday)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1.8fr 0.8fr 0.9fr 1fr;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:10px;color:var(--ink-soft);font-size:12px;">
          <div>Product</div>
          <div style="text-align:right;">Sold</div>
          <div style="text-align:right;">Remaining</div>
          <div style="text-align:right;">Earned</div>
        </div>
        ${productSalesHtml}
      `;
    }
  }

  /* ---------------- POS ---------------- */
  function renderCatTabs(){
    const cats = ["All", ...Object.keys(CATS)];
    $("#catTabs").innerHTML = cats.map(c=>
      `<button class="cat-tab ${c===activeCategory?'active':''}" data-cat="${c}">${c}</button>`
    ).join("");
  }
  $("#catTabs").addEventListener("click", e=>{
    const b = e.target.closest(".cat-tab");
    if(!b) return;
    activeCategory = b.dataset.cat;
    renderProducts();
  });

  function renderProducts(){
    renderCatTabs();
    const q = $("#posSearch").value.trim().toLowerCase();
    const list = products.filter(p=>{
      const matchesCat = activeCategory==="All" || p.category===activeCategory;
      const matchesQ = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });
    $("#productGrid").innerHTML = list.map(p=>{
      const out = !isRentProduct(p) && p.stock<=0;
      const low = !isRentProduct(p) && p.stock>0 && p.stock<=p.threshold;
      return `<button class="product-card" data-id="${p.id}" ${out?'disabled':''}>
        ${low?'<span class="low-tag">LOW</span>':''}
        <div class="product-swatch" style="background:${CATS[p.category]}">${initials(p.name)}</div>
        <div class="pname">${p.name}</div>
        <div class="pmeta">
          <span class="pprice mono">${money(p.price)}</span>
          <span class="pstock">${isRentProduct(p) ? 'Available for rent' : out ? 'Out of stock' : p.stock+' in stock'}</span>
        </div>
      </button>`;
    }).join("") || `<div class="empty"><h4>No products found</h4><p>Try a different search term.</p></div>`;
  }
  $("#posSearch").addEventListener("input", renderProducts);

  $("#productGrid").addEventListener("click", e=>{
    const card = e.target.closest(".product-card");
    if(!card || card.disabled) return;
    addToCart(Number(card.dataset.id));
  });

  function addToCart(id){
    const p = products.find(pp=>pp.id===id);
    if(!p) return;
    const line = cart.find(c=>c.productId===id);
    const currentQty = line ? line.qty : 0;
    if(!isRentProduct(p) && currentQty >= p.stock){ toast(`Only ${p.stock} of "${p.name}" in stock`); return; }
    if(line) line.qty++;
    else cart.push({productId:id, qty:1});
    renderCart();
  }
  function changeQty(id, delta){
    const line = cart.find(c=>c.productId===id);
    if(!line) return;
    const p = products.find(pp=>pp.id===id);
    const next = line.qty + delta;
    if(next<=0){ cart = cart.filter(c=>c.productId!==id); }
    else if(!isRentProduct(p) && next > p.stock){ toast(`Only ${p.stock} of "${p.name}" in stock`); }
    else { line.qty = next; }
    renderCart();
  }

  function cartTotals(){
    const subtotal = cart.reduce((s,c)=>{
      const p = products.find(pp=>pp.id===c.productId);
      return s + (p? p.price*c.qty : 0);
    },0);
    return {subtotal, tax: 0, total: subtotal};
  }

  function renderCart(){
    $("#orderMeta").textContent = `#${saleCounter} · Pickle Social`;
    if(cart.length===0){
      $("#cartItems").innerHTML = `<div class="empty" style="padding:34px 10px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:30px;height:30px;margin-bottom:8px;opacity:.5;"><rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 12h20"/></svg>
        <h4>Order is empty</h4><p>Tap a product to add it here.</p>
      </div>`;
    } else {
      $("#cartItems").innerHTML = cart.map(c=>{
        const p = products.find(pp=>pp.id===c.productId);
        return `<div class="rline">
          <div class="rinfo">
            <div class="rname">${p.name}</div>
            <div class="runit">${money(p.price)} each</div>
            <div class="qty-ctl">
              <button data-act="dec" data-id="${p.id}">−</button>
              <span>${c.qty}</span>
              <button data-act="inc" data-id="${p.id}">+</button>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="rtotal">${money(p.price*c.qty)}</div>
            <button class="rremove" data-act="rm" data-id="${p.id}">Remove</button>
          </div>
        </div>`;
      }).join("");
    }
    const {subtotal, total} = cartTotals();
    $("#sumSubtotal").textContent = money(subtotal);
    $("#sumTotal").textContent = money(total);
    $("#checkoutBtn").disabled = cart.length===0;
    updateChange();
  }
  $("#cartItems").addEventListener("click", e=>{
    const b = e.target.closest("button[data-act]");
    if(!b) return;
    const id = Number(b.dataset.id);
    if(b.dataset.act==="inc") changeQty(id, 1);
    if(b.dataset.act==="dec") changeQty(id, -1);
    if(b.dataset.act==="rm") { cart = cart.filter(c=>c.productId!==id); renderCart(); }
  });
  $("#clearCartBtn").addEventListener("click", ()=>{ cart=[]; renderCart(); });

  // payment method tabs
  $$(".pay-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      $$(".pay-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      payMethod = tab.dataset.pay;
      $("#tenderRow").style.display = payMethod==="cash" ? "block":"none";
      updateChange();
    });
  });

  function quickTenderButtons(total){
    const opts = new Set([Math.ceil(total), Math.ceil(total/5)*5, Math.ceil(total/10)*10, Math.ceil(total/20)*20]);
    $("#tenderQuick").innerHTML = Array.from(opts).slice(0,4).map(v=>
      `<button class="btn btn-sm" data-tender="${v}">${money(v)}</button>`).join("");
  }
  $("#tenderQuick").addEventListener("click", e=>{
    const b = e.target.closest("button[data-tender]");
    if(!b) return;
    $("#tenderInput").value = b.dataset.tender;
    updateChange();
  });
  $("#tenderInput").addEventListener("input", updateChange);

  function updateChange(){
    const {total} = cartTotals();
    quickTenderButtons(total);
    if(payMethod!="cash"){
      $("#changeDue").textContent = money(0);
      $("#checkoutBtn").disabled = cart.length===0;
      return;
    }
    const tendered = parseFloat($("#tenderInput").value)||0;
    const change = Math.max(0, tendered-total);
    $("#changeDue").textContent = money(change);
    $("#checkoutBtn").disabled = cart.length===0 || tendered < total;
  }

  async function deleteSaleRemote(saleId){
    const client = await getSupabaseClient();
    if (!client) return;
    try {
      await client.from("pos_sales").delete().eq("id", saleId);
    } catch (err) {
      console.warn("Unable to delete sale from Supabase", err);
    }
  }

  function addStockLogEntry(product, qty, note){
    const logEntry = {
      id: Date.now(),
      product_id: product.id,
      product_name: product.name,
      previous_stock: product.stock,
      added_stock: qty,
      new_stock: product.stock + qty,
      note,
      created_at: new Date().toISOString(),
    };
    stockLogs.unshift(logEntry);
    return logEntry;
  }

  $("#checkoutBtn").addEventListener("click", async ()=>{
    const {subtotal, total} = cartTotals();
    const tendered = payMethod==="cash" ? (parseFloat($("#tenderInput").value)||0) : total;
    const change = payMethod==="cash" ? tendered-total : 0;

    const saleItems = cart.map(c=>{
      const p = products.find(pp=>pp.id===c.productId);
      return {productId:p.id, name:p.name, sku:p.sku, price:p.price, qty:c.qty};
    });
    // decrement stock only for inventory items; rent items do not track stock changes
    cart.forEach(c=>{
      const p = products.find(pp=>pp.id===c.productId);
      if(p && !isRentProduct(p)) p.stock = Math.max(0, p.stock - c.qty);
    });

    const sale = {
      id: saleCounter++,
      time: new Date(),
      items: saleItems,
      subtotal, tax: 0, total,
      payment: payMethod,
      tendered, change,
      cashier: "Pickle Social"
    };
    sales.unshift(sale);
    cart = [];
    $("#tenderInput").value = "";
    renderCart();
    renderInventory();
    renderDashboard();
    renderProducts();
    toast(`Sale #${sale.id} completed — ${money(total)}`, true);
    openReceipt(sale);

    saveLocalData();
    try {
      await syncPosData();
    } catch (err) {
      console.warn("Unable to sync completed sale to Supabase", err);
    }
  });

  /* ---------------- Receipt modal ---------------- */
  function openReceipt(sale){
    const itemsHtml = sale.items.map(i=>
      `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;">
        <span>${i.qty}× ${i.name}</span><span class="mono">${money(i.price*i.qty)}</span>
      </div>`).join("");
    $("#receiptDetail").innerHTML = `
      <div class="success-mark">
        <div class="ring">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <div style="font-weight:700;font-size:15px;">Payment received</div>
        <div style="font-size:12px;color:var(--ink-soft);">Receipt #${sale.id} · ${sale.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <div style="border-top:1px dashed var(--border);padding-top:12px;">${itemsHtml}</div>
      <div style="border-top:1px dashed var(--border);margin-top:8px;padding-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-soft);padding:2px 0;"><span>Subtotal</span><span class="mono">${money(sale.subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;padding:8px 0 0;"><span>Total</span><span class="mono">${money(sale.total)}</span></div>
        ${sale.payment==="cash" ? `
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);padding:6px 0 0;"><span>Cash tendered</span><span class="mono">${money(sale.tendered)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);"><span>Change</span><span class="mono">${money(sale.change)}</span></div>`
        : `<div style="font-size:12px;color:var(--ink-soft);padding-top:6px;">Paid via GCash</div>`}
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
        <button class="btn btn-danger" id="receiptVoidBtn">Void sale</button>
      </div>`;
    $("#receiptModal").hidden = false;

    setTimeout(()=>{
      const btn = $("#receiptVoidBtn");
      if (btn) {
        btn.addEventListener("click", async ()=>{
          await voidLastSale(sale.id);
          $("#receiptModal").hidden = true;
        });
      }
    }, 0);
  }
  $("#receiptClose").addEventListener("click", ()=> $("#receiptModal").hidden = true);
  $("#receiptModal").addEventListener("click", e=>{ if(e.target===$("#receiptModal")) $("#receiptModal").hidden=true; });

  /* ---------------- Inventory ---------------- */
  function populateCatFilter(){
    $("#invCatFilter").innerHTML = `<option value="">All categories</option>` +
      Object.keys(CATS).map(c=>`<option value="${c}">${c}</option>`).join("");
  }
  populateCatFilter();

  function renderInventory(){
    const q = $("#invSearch").value.trim().toLowerCase();
    const cat = $("#invCatFilter").value;
    const list = products.filter(p=>{
      const mq = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      const mc = !cat || p.category===cat;
      return mq && mc;
    });
    $("#invEmpty").hidden = list.length>0;
    $("#invTableBody").innerHTML = list.map(p=>{
      const pct = Math.min(100, Math.round((p.stock/(p.threshold*2||1))*100));
      let status = `<span class="badge badge-ok"><i class="badge-dot"></i>In stock</span>`;
      if(p.stock===0) status = `<span class="badge badge-bad"><i class="badge-dot"></i>Out of stock</span>`;
      else if(p.stock<=p.threshold) status = `<span class="badge badge-warn"><i class="badge-dot"></i>Low stock</span>`;
      return `<tr draggable="true" data-id="${p.id}" class="draggable-row">
        <td><b>${p.name}</b></td>
        <td class="mono">${p.sku}</td>
        <td>${p.category}</td>
        <td><span class="stockbar"><i style="width:${pct}%;background:${p.stock===0?'var(--red)':p.stock<=p.threshold?'var(--amber)':'var(--accent)'}"></i></span>${p.stock}</td>
        <td class="mono">${money(p.price)}</td>
        <td class="mono">${money(p.cost)}</td>
        <td>${status}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn btn-ghost btn-sm" data-act="stock" data-id="${p.id}">Add Stock</button>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">Edit</button>
          <button class="btn btn-ghost btn-sm btn-danger" data-act="del" data-id="${p.id}">Delete</button>
        </td>
      </tr>`;
    }).join("");
    renderStockLogs();
  }

  function reorderInventory(sourceId, destId){
    const sourceIndex = products.findIndex(p=>p.id===sourceId);
    const destIndex = products.findIndex(p=>p.id===destId);
    if(sourceIndex === -1 || destIndex === -1 || sourceIndex === destIndex) return;
    const [moved] = products.splice(sourceIndex, 1);
    products.splice(destIndex, 0, moved);
    saveLocalData();
    renderInventory();
    try { syncPosData(); } catch (err) { console.warn('Unable to sync product order', err); }
  }

  $("#invTableBody").addEventListener("dragstart", e=>{
    const tr = e.target.closest("tr");
    if(!tr) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tr.dataset.id || "");
    tr.classList.add("dragging");
  });

  $("#invTableBody").addEventListener("dragend", e=>{
    const tr = e.target.closest("tr");
    if(tr) tr.classList.remove("dragging");
    $$("#invTableBody tr").forEach(row=>row.classList.remove("drag-over"));
  });

  $("#invTableBody").addEventListener("dragover", e=>{
    e.preventDefault();
    const tr = e.target.closest("tr");
    if(!tr) return;
    tr.classList.add("drag-over");
    e.dataTransfer.dropEffect = "move";
  });

  $("#invTableBody").addEventListener("dragleave", e=>{
    const tr = e.target.closest("tr");
    if(tr) tr.classList.remove("drag-over");
  });

  $("#invTableBody").addEventListener("drop", e=>{
    e.preventDefault();
    const target = e.target.closest("tr");
    if(!target) return;
    target.classList.remove("drag-over");
    const sourceId = Number(e.dataTransfer.getData("text/plain"));
    const destId = Number(target.dataset.id);
    if(sourceId && destId && sourceId !== destId){
      reorderInventory(sourceId, destId);
    }
  });

  function renderStockLogs(){
    if(stockLogs.length===0){
      $("#stockLogsList").innerHTML = `<div class="empty" style="padding:20px 20px;"><p>No stock changes logged yet.</p></div>`;
      return;
    }
    $("#stockLogsList").innerHTML = stockLogs.slice(0,8).map(log=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:13px;font-weight:600;">${log.product_name}</div>
          <div style="font-size:11px;color:var(--ink-soft);">${log.added_stock > 0 ? `Added ${log.added_stock} units` : "Updated stock"} · ${new Date(log.created_at).toLocaleString()}</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--accent-dark);">${log.new_stock} in stock</div>
      </div>
    `).join("");
  }
  $("#invSearch").addEventListener("input", renderInventory);
  $("#invCatFilter").addEventListener("change", renderInventory);

  let editingId = null;
  function openModal(product){
    editingId = product ? product.id : null;
    $("#modalTitle").textContent = product ? "Edit product" : "Add product";
    $("#f_name").value = product?.name || "";
    $("#f_sku").value = product?.sku || "";
    $("#f_category").value = product?.category || "Beverages";
    $("#f_price").value = product?.price ?? "";
    $("#f_cost").value = product?.cost ?? "";
    $("#f_stock").value = product?.stock ?? "";
    $("#f_threshold").value = product?.threshold ?? 10;
    $("#productModal").hidden = false;
  }
  function closeModal(){ $("#productModal").hidden = true; }
  $("#addProductBtn").addEventListener("click", ()=> openModal(null));
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalCancel").addEventListener("click", closeModal);
  $("#productModal").addEventListener("click", e=>{ if(e.target===$("#productModal")) closeModal(); });

  $("#modalSave").addEventListener("click", async ()=>{
    const name = $("#f_name").value.trim();
    const sku = $("#f_sku").value.trim();
    const price = parseFloat($("#f_price").value);
    if(!name || !sku || isNaN(price)){ toast("Please fill in name, SKU and price"); return; }

    const data = {
      name, sku,
      category: $("#f_category").value,
      price,
      cost: parseFloat($("#f_cost").value)||0,
      stock: parseInt($("#f_stock").value)||0,
      threshold: parseInt($("#f_threshold").value)||10,
    };

    try {
      const client = await getSupabaseClient();
      if (!client) {
        toast("Supabase is not available right now", false);
        return;
      }

      if(editingId){
        const p = products.find(pp=>pp.id===editingId);
        Object.assign(p, {id: editingId, ...data});
        await client.from("pos_products").update({ ...data }).eq("id", editingId);
        toast(`"${name}" updated`, true);
      } else {
        const id = Date.now();
        const product = {id, ...data};
        products.push(product);
        await client.from("pos_products").insert([product]);
        toast(`"${name}" added to inventory`, true);
      }

      saveLocalData();
      closeModal();
      renderInventory();
      renderProducts();
      renderDashboard();
    } catch (err) {
      console.error(err);
      toast("Could not save product to Supabase", false);
    }
  });

  $("#invTableBody").addEventListener("click", async e=>{
    const b = e.target.closest("button[data-act]");
    if(!b) return;
    const id = Number(b.dataset.id);
    const p = products.find(pp=>pp.id===id);
    if(!p) return;
    if(b.dataset.act==="edit") openModal(p);
    if(b.dataset.act==="stock"){
      const qty = parseInt(window.prompt(`Add stock for ${p.name}`, "0"), 10);
      if(Number.isNaN(qty) || qty <= 0) return;
      const previousStock = p.stock;
      p.stock = previousStock + qty;
      try {
        const client = await getSupabaseClient();
        if (client) {
          await client.from("pos_products").update({ stock: p.stock }).eq("id", p.id);
          const logEntry = {
            id: Date.now(),
            product_id: p.id,
            product_name: p.name,
            previous_stock: previousStock,
            added_stock: qty,
            new_stock: p.stock,
            note: "Stock added from inventory",
            created_at: new Date().toISOString(),
          };
          await client.from("pos_stock_logs").insert([logEntry]);
          stockLogs.unshift(logEntry);
        } else {
          stockLogs.unshift({
            id: Date.now(),
            product_id: p.id,
            product_name: p.name,
            previous_stock: previousStock,
            added_stock: qty,
            new_stock: p.stock,
            note: "Stock added from inventory",
            created_at: new Date().toISOString(),
          });
        }
        saveLocalData();
        renderInventory();
        renderProducts();
        renderDashboard();
        toast(`Added ${qty} to ${p.name}`, true);
      } catch (err) {
        console.error(err);
        toast("Could not save stock update", false);
      }
    }
    if(b.dataset.act==="del"){
      if(confirm(`Remove "${p.name}" from inventory?`)){
        products = products.filter(pp=>pp.id!==id);
        cart = cart.filter(c=>c.productId!==id);
        saveLocalData();
        await deleteProductRemote(id);
        try {
          await syncPosData();
        } catch (err) {
          console.warn("Could not sync product deletion to Supabase", err);
        }
        renderInventory();
        renderProducts();
        renderDashboard();
        toast(`"${p.name}" removed`, true);
      }
    }
  });

  /* ---------------- Sales History ---------------- */
  function exportSalesToExcel(){
    if (typeof XLSX === 'undefined') {
      toast('Office export unavailable. Ensure XLSX is loaded.', false);
      return;
    }

    const rows = [
      ['Receipt', 'Date', 'Time', 'Items', 'Payment', 'Total', 'Cashier']
    ];

    sales.forEach(s => {
      const saleDate = new Date(s.time);
      const itemCount = s.items.reduce((a,i)=>a+i.qty,0);
      rows.push([
        `#${s.id}`,
        saleDate.toLocaleDateString(),
        saleDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
        itemCount,
        s.payment,
        s.total.toFixed(2),
        s.cashier || 'Pickle Social'
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    const fileName = `COUNTR-Sales-History-${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast('Sales export ready', true);
  }

  function renderSales(){
    $("#salesCount").textContent = sales.length ? `${sales.length} total` : "";
    $("#salesEmpty").hidden = sales.length>0;
    $("#salesTableBody").innerHTML = sales.map(s=>{
      const itemCount = s.items.reduce((a,i)=>a+i.qty,0);
      return `<tr>
        <td class="mono">#${s.id}</td>
        <td>${s.time.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
        <td>${itemCount} item${itemCount!==1?'s':''}</td>
        <td style="text-transform:capitalize;">${s.payment}</td>
        <td class="mono"><b>${money(s.total)}</b></td>
        <td style="text-align:right;"><button class="btn btn-ghost btn-sm" data-id="${s.id}">View</button></td>
      </tr>`;
    }).join("");
  }
  $("#salesTableBody").addEventListener("click", e=>{
    const b = e.target.closest("button[data-id]");
    if(!b) return;
    const sale = sales.find(s=>s.id===Number(b.dataset.id));
    if(sale) openReceipt(sale);
  });

  /* ---------------- Init ---------------- */
  (async function init(){
    await loadPosData();
    renderCart();
    renderDashboard();
    renderInventory();
    renderSales();
    const exportBtn = $("#exportSalesBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportSalesToExcel);
    const toggleBtn = $("#toggleSalesDayBtn");
    if (toggleBtn) toggleBtn.addEventListener("click", () => {
      productSalesDay = productSalesDay === "today" ? "yesterday" : "today";
      toggleBtn.textContent = productSalesDay === "today" ? "Yesterday" : "Today";
      renderDashboard();
    });
    showView(initialView);
  })();
})();
