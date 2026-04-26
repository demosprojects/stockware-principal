import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://fxqomvjynncaigwoasqp.supabase.co";
const supabaseKey = "sb_publishable_Mwq88wTGFEHF9zvvM7xWmw_9FQmjlZO";
const supabase = createClient(supabaseUrl, supabaseKey);

const storeId = localStorage.getItem("store_id");
let products = [];
let cart = [];
let currentSelectedProduct = null;
let currentStore = null; 

const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('currentDateDisplay').innerText = new Intl.DateTimeFormat('es-AR', options).format(new Date());

// ==========================================
// 1. INICIALIZACIÓN Y SEGURIDAD
// ==========================================
async function initPos() {
  const { data: userData } = await supabase.auth.getUser();
  
  if (!userData.user || !storeId) {
    window.location.href = "index.html";
    return;
  }

  const { data: store, error } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single();

  const now = new Date();
  const isExpired = store?.expires_at && new Date(store.expires_at) < now;

  if (error || !store.active || isExpired) {
    showAlert('Acceso denegado', 'Tienda inactiva o suscripción vencida. Contactá al administrador.', 'error');
    await supabase.auth.signOut();
    window.location.href = "index.html";
    return;
  }

  currentStore = store;
  document.getElementById("storeNameDisplay").innerText = store.name;
  loadProducts();
}

// ==========================================
// 2. ENRUTADOR (SPA NAV)
// ==========================================
window.switchView = (view) => {
  document.getElementById("posView").classList.add("hidden");
  document.getElementById("productsView").classList.add("hidden");
  document.getElementById("salesView").classList.add("hidden");
  document.getElementById("configView").classList.add("hidden");
  
  document.getElementById(`${view}View`).classList.remove("hidden");

  const navIds = ['nav-pos', 'nav-products', 'nav-sales', 'nav-config'];
  navIds.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.className = "w-full flex items-center gap-2.5 px-3 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm font-medium border border-transparent transition-all";
  });

  const activeEl = document.getElementById(`nav-${view}`);
  if(activeEl) {
    activeEl.className = "w-full flex items-center gap-2.5 px-3 py-2.5 bg-indigo-500/10 text-indigo-400 rounded-lg text-sm font-medium border border-indigo-500/20 transition-all";
  }

  if (view === "sales") loadSales();
  if (view === "config") loadConfig();
};

// ==========================================
// 3. CARGA Y RENDERIZADO BÁSICO
// ==========================================
async function loadProducts() {
  const loading = document.getElementById("loadingProducts");
  if(loading) loading.style.display = "block";

  const { data, error } = await supabase
    .from("products")
    .select(`*, variants (*)`)
    .eq("store_id", storeId)
    .order('created_at', { ascending: false });

  if(loading) loading.style.display = "none";

  if (error) {
    console.error(error);
    return;
  }

  products = data || [];
  renderPosGrid(products);
  renderProductsTable();
}

// ==========================================
// 4. MÓDULO POS (Terminal)
// ==========================================
function renderPosGrid(productsToRender) {
  const grid = document.getElementById("productsGrid");
  grid.innerHTML = "";

  if (productsToRender.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center text-sm text-slate-500 mt-10">No se encontraron productos.</div>`;
    return;
  }

  productsToRender.forEach(prod => {
    const stockTotal = prod.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
    const hasVariants = prod.variants.length > 0;

    const card = document.createElement("div");
    card.className = "bg-slate-800 border border-slate-700 hover:border-indigo-500/50 rounded-xl p-3 hover:shadow-[0_0_12px_rgba(99,102,241,0.15)] transition-all cursor-pointer flex flex-col justify-between group active:scale-95";
    card.onclick = () => hasVariants ? openVariantModal(prod.id) : addToCart(prod.id, null);

    const imgHtml = prod.image_url
      ? `<img src="${prod.image_url}" alt="${prod.name}" class="w-full h-full object-contain p-1" onerror="this.parentElement.innerHTML='<svg class=\\'w-10 h-10\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.2\\' d=\\'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z\\'></path></svg>'">`
      : `<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>`;
    
    card.innerHTML = `
      <div>
        <div class="w-full h-36 bg-slate-900 rounded-lg mb-3 flex items-center justify-center text-slate-700 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors duration-300 overflow-hidden">
           ${imgHtml}
        </div>
        <h3 class="font-semibold text-sm text-white leading-tight mb-1 truncate">${prod.name}</h3>
        <p class="text-[10px] text-slate-400 mb-2">Stock: <span class="${stockTotal > 0 ? 'text-green-400' : 'text-red-400'}">${stockTotal}u</span></p>
      </div>
      <div class="flex justify-between items-end">
        <span class="text-sm font-bold text-white">$${Number(prod.price).toLocaleString('es-AR')}</span>
        <div class="bg-slate-700/50 text-slate-300 p-1.5 rounded-md group-hover:bg-indigo-500 group-hover:text-white transition-colors">
           <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  const term = e.target.value.toLowerCase();
  const filtered = products.filter(p => p.name.toLowerCase().includes(term));
  renderPosGrid(filtered);
});

window.openVariantModal = (productId) => {
  currentSelectedProduct = products.find(p => p.id === productId);
  if (!currentSelectedProduct) return;

  document.getElementById("modalProductName").innerText = currentSelectedProduct.name;
  const list = document.getElementById("modalVariantsList");
  list.innerHTML = "";

  currentSelectedProduct.variants.forEach(variant => {
    const isOutOfStock = variant.stock <= 0;
    const btn = document.createElement("button");
    btn.className = `w-full text-left p-3 rounded-lg border flex justify-between items-center transition-all mb-2
      ${isOutOfStock ? 'opacity-40 cursor-not-allowed border-slate-800 bg-slate-900/50' : 'border-slate-700 bg-slate-800 hover:border-indigo-500 hover:bg-slate-700'}`;
    
    btn.innerHTML = `
      <div>
        <span class="font-bold text-sm text-white mr-2">${variant.size || 'N/A'}</span>
        <span class="text-xs text-slate-400">${variant.color || ''}</span>
      </div>
      <span class="text-[10px] font-bold px-2 py-1 rounded-md ${isOutOfStock ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
        ${isOutOfStock ? 'Agotado' : `Stock: ${variant.stock}`}
      </span>
    `;

    if (!isOutOfStock) {
      btn.onclick = () => {
        addToCart(currentSelectedProduct.id, variant);
        closeVariantModal();
      };
    }
    list.appendChild(btn);
  });

  document.getElementById("variantModal").classList.remove("hidden");
};

window.closeVariantModal = () => {
  document.getElementById("variantModal").classList.add("hidden");
  currentSelectedProduct = null;
};

// ==========================================
// TICKET Y MODAL DE VENTA EXITOSA
// ==========================================
window.closeSuccessModal = () => {
  document.getElementById("successModal").classList.add("hidden");
};

function addToCart(productId, variant) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const cartItemId = variant ? `${product.id}-${variant.id}` : product.id;
  const existingItem = cart.find(item => item.cartId === cartItemId);

  if (existingItem) {
    if (variant && existingItem.qty >= variant.stock) {
        showAlert('Stock máximo', 'Ya tenés el máximo de stock disponible para esta variante en el ticket.', 'warning');
        return;
    }
    existingItem.qty += 1;
  } else {
    cart.push({ 
      cartId: cartItemId,
      productId: product.id,
      variantId: variant ? variant.id : null,
      name: product.name,
      price: product.price,
      size: variant ? variant.size : '',
      color: variant ? variant.color : '',
      qty: 1,
      currentStock: variant ? variant.stock : 0 
    });
  }
  renderCart();
}

function renderCart() {
  const container = document.getElementById("cartItems");
  const mobileContainer = document.getElementById("mobileCartItems");
  const subtotalSpan = document.getElementById("subtotalDisplay");
  const totalSpan = document.getElementById("totalDisplay");
  const mobileTotalSpan = document.getElementById("mobileTotalDisplay");
  const mobileCartCount = document.getElementById("mobileCartCount");
  const cartBadge = document.getElementById("cartBadge");

  let total = 0;
  const emptyHTML = `
    <div class="flex flex-col items-center justify-center py-6 text-slate-500 space-y-2 h-full">
      <svg class="w-7 h-7 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
      <span class="text-xs font-medium">Ticket vacío</span>
    </div>`;

  if (cart.length === 0) {
    if (container) container.innerHTML = emptyHTML;
    if (mobileContainer) mobileContainer.innerHTML = emptyHTML;
    if (subtotalSpan) subtotalSpan.innerText = "$0";
    if (totalSpan) totalSpan.innerText = "$0";
    if (mobileTotalSpan) mobileTotalSpan.innerText = "$0";
    if (mobileCartCount) mobileCartCount.innerText = "0 items";
    if (cartBadge) { cartBadge.innerText = "0"; cartBadge.style.display = "none"; }
    updateCheckoutBtn();
    return;
  }

  if (container) container.innerHTML = "";
  if (mobileContainer) mobileContainer.innerHTML = "";

  let totalItems = 0;

  cart.forEach((item, index) => {
    total += item.price * item.qty;
    totalItems += item.qty;
    const variantText = item.size || item.color ? `<p class="text-[10px] text-slate-400 mt-0.5">${item.size} • ${item.color}</p>` : '';
    const itemHTML = `
      <div class="flex justify-between items-start bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 group mb-2">
        <div class="flex-1 pr-2">
          <h4 class="font-semibold text-white text-xs leading-tight">${item.name}</h4>
          ${variantText}
          <div class="text-indigo-400 font-bold text-xs mt-1">$${Number(item.price).toLocaleString('es-AR')}</div>
        </div>
        <div class="flex flex-col items-end gap-1.5">
          <button onclick="removeFromCart(${index})" class="text-slate-500 hover:text-red-400 transition-colors p-0.5">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
          <div class="bg-slate-900 border border-slate-700 rounded-md flex items-center px-1.5 py-0.5 shadow-sm">
            <span class="text-[10px] font-bold text-white px-0.5">x${item.qty}</span>
          </div>
        </div>
      </div>`;

    if (container) {
      const div = document.createElement("div");
      div.innerHTML = itemHTML;
      container.appendChild(div.firstElementChild);
    }
    if (mobileContainer) {
      const div = document.createElement("div");
      div.innerHTML = itemHTML;
      mobileContainer.appendChild(div.firstElementChild);
    }
  });

  const formatted = `$${total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;
  if (subtotalSpan) subtotalSpan.innerText = formatted;
  if (totalSpan) totalSpan.innerText = formatted;
  if (mobileTotalSpan) mobileTotalSpan.innerText = formatted;
  if (mobileCartCount) mobileCartCount.innerText = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;
  if (cartBadge) {
    cartBadge.innerText = totalItems > 9 ? '9+' : totalItems;
    cartBadge.style.display = "flex";
    cartBadge.classList.add('pulse-once');
    setTimeout(() => cartBadge.classList.remove('pulse-once'), 400);
  }
  updateCheckoutBtn();
}

function updateCheckoutBtn() {
  const btns = [
    document.getElementById('btnCheckout'),
    document.getElementById('btnCheckoutMobile'),
  ];
  btns.forEach(btn => {
    if (!btn) return;
    if (cart.length > 0) {
      btn.disabled = false;
      btn.style.pointerEvents = '';
      btn.className = 'w-full bg-indigo-500 hover:bg-indigo-400 text-white py-3 rounded-xl font-bold text-sm shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all active:scale-[0.98] flex items-center justify-center gap-2';
    } else {
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
      btn.className = 'w-full bg-slate-700 text-slate-500 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-not-allowed';
    }
  });
}

window.removeFromCart = (index) => {
  cart.splice(index, 1);
  renderCart();
};

window.checkoutMobile = async () => {
  // Sync mobile payment to desktop select before calling checkout
  const mobilePay = document.getElementById("paymentMethodMobile");
  const desktopPay = document.getElementById("paymentMethod");
  if (mobilePay && desktopPay) desktopPay.value = mobilePay.value;
  await checkout();
};

window.checkout = async () => {
  if (cart.length === 0) return; // El botón solo está activo cuando hay items

  const btn = document.getElementById("btnCheckout");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Procesando...`;

  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const selectedPaymentMethod = document.getElementById("paymentMethod").value;

  const { data: saleData, error: saleError } = await supabase
    .from("sales")
    .insert({ store_id: storeId, total: total, payment_method: selectedPaymentMethod })
    .select().single();

  if (saleError) {
    btn.disabled = false;
    btn.innerHTML = "Finalizar compra";
    showAlert('Error al procesar', 'No se pudo registrar la venta. Intentá de nuevo.', 'error');
    return;
  }

  const saleItemsToInsert = cart.map(item => ({
    sale_id: saleData.id,
    variant_id: item.variantId,
    quantity: item.qty,
    price: item.price
  }));

  const { error: itemsError } = await supabase.from("sale_items").insert(saleItemsToInsert);
  if (itemsError) {
    btn.disabled = false;
    btn.innerHTML = "Finalizar compra";
    showAlert('Error en detalle', 'Venta registrada, pero hubo un problema al guardar el detalle de ítems.', 'error');
    return;
  }

  for (const item of cart) {
    if (item.variantId) {
      const newStock = item.currentStock - item.qty;
      const { error: stockError } = await supabase
        .from('variants')
        .update({ stock: newStock })
        .eq('id', item.variantId);
        
      if (stockError) console.error(`Error descontando stock para variante ${item.variantId}`, stockError);
    }
  }
  
  // Renderizar Ticket antes de limpiar el carrito
  renderTicketPreview(saleData, cart, selectedPaymentMethod);
  document.getElementById("successModal").classList.remove("hidden");
  if (typeof closeMobileCart === 'function') closeMobileCart();
  
  btn.disabled = false;
  btn.innerHTML = "Finalizar compra";

  cart = [];
  renderCart();
  loadProducts(); 
};

// ==========================================
// RENDERIZADO Y EXPORTACIÓN DEL TICKET
// ==========================================
function renderTicketPreview(sale, cartItems, method) {
    // Logo
    const logoWrapper = document.getElementById("tkLogoWrapper");
    const logoImg = document.getElementById("tkLogo");
    if (currentStore.logo_url) {
        logoImg.src = currentStore.logo_url;
        logoWrapper.classList.remove("hidden");
    } else {
        logoWrapper.classList.add("hidden");
    }

    document.getElementById("tkStoreName").innerText = currentStore.name.toUpperCase();
    
    let contactHtml = "";
    if(currentStore.phone) contactHtml += `Contacto: ${currentStore.phone}<br>`;
    if(currentStore.instagram) contactHtml += `Instagram: @${currentStore.instagram.replace('@', '')}`;
    document.getElementById("tkStoreContact").innerHTML = contactHtml;

    // Dirección / info extra
    const addrEl = document.getElementById("tkStoreAddress");
    addrEl.innerText = currentStore.address || "";
    addrEl.style.display = currentStore.address ? "" : "none";

    const rawTsTicket = sale.created_at.endsWith('Z') || sale.created_at.includes('+') ? sale.created_at : sale.created_at + 'Z';
    const dateObj = new Date(rawTsTicket);
    const tzAR = { timeZone: 'America/Argentina/Buenos_Aires' };
    document.getElementById("tkDate").innerText = dateObj.toLocaleDateString('es-AR', tzAR) + " " + dateObj.toLocaleTimeString('es-AR', { ...tzAR, hour: '2-digit', minute:'2-digit', hour12: false });
    document.getElementById("tkId").innerText = sale.id.split('-')[0].toUpperCase();
    document.getElementById("tkPayment").innerText = method;

    const itemsContainer = document.getElementById("tkItems");
    itemsContainer.innerHTML = "";
    
    cartItems.forEach(item => {
        const variantLabel = (item.size || item.color) ? ` (${item.size||''} ${item.color||''})`.trim() : '';
        const itemTotal = item.price * item.qty;
        itemsContainer.innerHTML += `
            <div class="flex justify-between items-start">
                <div class="flex-1 leading-tight pr-2">
                    <span class="font-bold">${item.qty}x</span> ${item.name}${variantLabel}
                </div>
                <div class="font-bold">
                    $${itemTotal.toLocaleString('es-AR')}
                </div>
            </div>
        `;
    });

    document.getElementById("tkTotal").innerText = "$" + Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 });
}

window.printTicket = () => {
    const ticketHtml = document.getElementById("ticketCaptureArea").innerHTML;
    // Abrimos un popup limpio exclusivo para la tiquetera térmica
    const printWindow = window.open('', '', 'width=400,height=600');
    printWindow.document.write(`
        <html>
            <head>
                <title>Imprimir Ticket</title>
                <style>
                    @page { margin: 0; }
                    body { font-family: 'Courier New', Courier, monospace; padding: 15px; margin: 0; color: #000; width: 100%; max-width: 80mm; font-size: 11px; line-height: 1.3; }
                    .text-center { text-align: center; }
                    .font-bold { font-weight: bold; }
                    .font-black { font-weight: 900; }
                    .text-lg { font-size: 16px; }
                    .text-sm { font-size: 14px; }
                    .text-\\[10px\\] { font-size: 10px; }
                    .mb-1 { margin-bottom: 4px; }
                    .mb-2 { margin-bottom: 8px; }
                    .mb-4 { margin-bottom: 16px; }
                    .mt-1 { margin-top: 4px; }
                    .pb-2 { padding-bottom: 8px; }
                    .space-y-1 > * + * { margin-top: 4px; }
                    .border-b { border-bottom: 1px dashed #000; }
                    .flex { display: flex; }
                    .justify-between { justify-content: space-between; }
                    .items-start { align-items: flex-start; }
                    .flex-1 { flex: 1; }
                    .uppercase { text-transform: uppercase; }
                    .tracking-tight { letter-spacing: -0.025em; }
                    .leading-none { line-height: 1; }
                    .leading-tight { line-height: 1.25; }
                    .text-gray-700, .text-gray-600 { color: #333; }
                    img { display: block; max-height: 48px; max-width: 120px; object-fit: contain; margin: 0 auto 4px; }
                    .hidden { display: none; }
                    #tkLogoWrapper { display: flex; justify-content: center; margin-bottom: 6px; }
                    #tkLogoWrapper.hidden { display: none; }
                    .text-\\[9px\\] { font-size: 9px; }
                    .tracking-wide { letter-spacing: 0.05em; }
                    .border-t { border-top: 1px dashed #ccc; }
                    .pt-3 { padding-top: 12px; }
                    .mb-1 { margin-bottom: 4px; }
                    .text-gray-400 { color: #9ca3af; }
                    .text-gray-500 { color: #6b7280; }
                </style>
            </head>
            <body>${ticketHtml}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
};

window.reprintTicket = (saleId) => {
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) return;

    const cartItems = (sale.sale_items || []).map(item => ({
        name: item.variants?.products?.name || 'Producto',
        size: item.variants?.size || '',
        color: item.variants?.color || '',
        qty: item.quantity,
        price: item.price,
    }));

    renderTicketPreview(sale, cartItems, sale.payment_method);

    // Cambiar el botón "Nueva Venta" por "Cerrar" en modo reimpresión
    const closeBtn = document.getElementById("btnSuccessClose");
    if (closeBtn) {
        closeBtn.innerText = "Cerrar";
        closeBtn.onclick = () => {
            document.getElementById("successModal").classList.add("hidden");
            closeBtn.innerText = "Nueva Venta";
            closeBtn.onclick = closeSuccessModal;
        };
    }

    document.getElementById("successModal").classList.remove("hidden");
};

window.downloadTicketImage = async () => {
    const btn = document.getElementById("btnWaImage");
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="animate-pulse">Generando...</span>`;
    btn.disabled = true;
    
    const ticketEl = document.getElementById("ticketCaptureArea");
    
    try {
        const canvas = await html2canvas(ticketEl, {
            scale: 3,
            backgroundColor: "#FFFFFF",
            useCORS: true,
            allowTaint: true,
            logging: false
        });
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `Ticket_${Date.now()}.png`;
        a.click();
    } catch (e) {
        console.error("Error generando ticket:", e);
        showToast("Error al generar la imagen", "error");
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};


// ==========================================
// 5. MÓDULO GESTIÓN DE PRODUCTOS
// ==========================================
function renderProductsTable() {
  const grid = document.getElementById("productsCardGrid");
  if (!grid) return;
  grid.innerHTML = "";

  if (products.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-20 text-center">
        <svg class="w-12 h-12 text-slate-700 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
        <p class="text-sm text-slate-400 font-medium">Aún no hay productos</p>
        <p class="text-xs text-slate-600 mt-1">Añadí el primero para comenzar.</p>
      </div>`;
    return;
  }

  products.forEach(prod => {
    const stockTotal = prod.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
    const stockColor = stockTotal === 0 ? 'text-red-400 bg-red-500/10 border-red-500/20' : stockTotal <= 5 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';

    const card = document.createElement("div");
    card.className = "bg-slate-800 border border-slate-700 rounded-xl p-3 flex flex-col justify-between transition-all";

    const imgHtml = prod.image_url
      ? `<img src="${prod.image_url}" alt="${prod.name}" class="w-full h-full object-contain p-1" onerror="this.parentElement.innerHTML='<svg class=\\'w-10 h-10 text-slate-600\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.2\\' d=\\'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4\\'></path></svg>'">`
      : `<svg class="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>`;

    const variantBadges = prod.variants.slice(0, 2).map(v =>
      `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-900 text-slate-400 border border-slate-700/50">${v.size}${v.color ? ' · ' + v.color : ''}</span>`
    ).join('');
    const extraVariants = prod.variants.length > 2 ? `<span class="text-[9px] text-slate-600">+${prod.variants.length - 2} más</span>` : '';

    card.innerHTML = `
      <div>
        <div class="w-full h-36 bg-slate-900 rounded-lg mb-3 flex items-center justify-center text-slate-700 overflow-hidden">
          ${imgHtml}
        </div>
        <h3 class="font-semibold text-sm text-white leading-tight mb-1 truncate">${prod.name}</h3>
        <p class="text-sm font-bold text-indigo-400 mb-2">$${Number(prod.price).toLocaleString('es-AR')}</p>
        <div class="flex flex-wrap gap-1 mb-2">${variantBadges}${extraVariants}</div>
      </div>
      <div class="flex items-center justify-between pt-2 border-t border-slate-700/50">
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${stockColor}">${stockTotal}u</span>
        <div class="flex gap-1.5">
          <button onclick="openEditProductModal('${prod.id}')" class="w-7 h-7 bg-slate-700 hover:bg-indigo-500 text-slate-300 hover:text-white rounded-md flex items-center justify-center transition-all border border-slate-600 hover:border-indigo-500" title="Editar">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
          </button>
          <button onclick="deleteProduct('${prod.id}')" class="w-7 h-7 bg-slate-700 hover:bg-red-500 text-slate-300 hover:text-white rounded-md flex items-center justify-center transition-all border border-slate-600 hover:border-red-500" title="Eliminar">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

window.openProductModal = () => {
  document.getElementById("pName").value = "";
  document.getElementById("pPrice").value = "";
  document.getElementById("pImageUrl").value = "";
  document.getElementById("pImagePreview").innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
  document.getElementById("variantsContainer").innerHTML = "";
  addVariantRow(); 
  document.getElementById("addProductModal").classList.remove("hidden");
};

window.closeProductModal = () => {
  document.getElementById("addProductModal").classList.add("hidden");
};

window.addVariantRow = () => {
  const container = document.getElementById("variantsContainer");
  const rowId = 'var-' + Date.now();
  
  const div = document.createElement("div");
  div.className = "flex gap-2.5 items-center variant-row mb-2.5";
  div.id = rowId;
  div.innerHTML = `
    <input type="text" placeholder="Talle (Ej: M)" class="var-size w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="text" placeholder="Color (Ej: Negro)" class="var-color w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="number" placeholder="Stock" class="var-stock w-1/4 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <button onclick="document.getElementById('${rowId}').remove()" class="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-red-400 bg-slate-800 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 rounded-lg transition">&times;</button>
  `;
  container.appendChild(div);
};

window.saveProduct = async () => {
  const name = document.getElementById("pName").value.trim();
  const price = document.getElementById("pPrice").value;
  const image_url = document.getElementById("pImageUrl").value.trim() || null;
  const btn = document.getElementById("btnSaveProduct");
  
  if (!name || !price) { showAlert('Campos requeridos', 'Completá el nombre y el precio base del producto.', 'warning'); return; }

  const variantRows = document.querySelectorAll('.variant-row');
  let variantsData = [];
  
  variantRows.forEach(row => {
    const size = row.querySelector('.var-size').value.trim();
    const color = row.querySelector('.var-color').value.trim();
    const stock = row.querySelector('.var-stock').value;
    
    if (size || color) {
      variantsData.push({ size, color, stock: parseInt(stock) || 0 });
    }
  });

  if (variantsData.length === 0) { showAlert('Sin variantes', 'Agregá al menos una variante con talle o color.', 'warning'); return; }

  btn.innerText = "Guardando...";
  btn.disabled = true;

  const { data: newProduct, error: prodError } = await supabase
    .from("products")
    .insert([{ store_id: storeId, name, price, image_url }])
    .select().single();

  if (prodError) {
    btn.innerText = "Guardar";
    btn.disabled = false;
    showAlert('Error al guardar', 'No se pudo crear el producto en la base de datos. Intentá de nuevo.', 'error');
    return;
  }

  const variantsToInsert = variantsData.map(v => ({ ...v, product_id: newProduct.id }));
  const { error: varError } = await supabase.from("variants").insert(variantsToInsert);

  if (varError) showAlert('Variantes no guardadas', 'El producto fue creado, pero hubo un error al guardar las variantes.', 'error');

  btn.innerText = "Guardar";
  btn.disabled = false;
  closeProductModal();
  loadProducts();
};

window.deleteProduct = async (id) => {
  const ok = await showConfirm('Eliminar producto', '¿Seguro que querés eliminar este producto? La acción es irreversible.');
  if (!ok) return;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if(error) console.error(error);
  loadProducts();
};

// ==========================================
// 6. MÓDULO EDICIÓN DE PRODUCTOS
// ==========================================
window.openEditProductModal = (productId) => {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById("editPId").value = prod.id;
  document.getElementById("editPName").value = prod.name;
  document.getElementById("editPPrice").value = prod.price;
  
  const imgUrl = prod.image_url || '';
  document.getElementById("editPImageUrl").value = imgUrl;
  const preview = document.getElementById("editPImagePreview");
  if (imgUrl) {
    preview.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover rounded-lg" onerror="this.parentElement.innerHTML='<svg class=\\'w-5 h-5 text-slate-600\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg>'">`;
  } else {
    preview.innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
  }

  const container = document.getElementById("editVariantsContainer");
  container.innerHTML = "";
  prod.variants.forEach(v => addEditVariantRow(v));

  document.getElementById("editProductModal").classList.remove("hidden");
};

window.closeEditProductModal = () => {
  document.getElementById("editProductModal").classList.add("hidden");
};

window.addEditVariantRow = (variant = null) => {
  const container = document.getElementById("editVariantsContainer");
  const rowId = 'edit-var-' + Date.now() + Math.random();

  const div = document.createElement("div");
  div.className = "flex gap-2.5 items-center edit-variant-row mb-2.5";
  div.id = rowId;
  div.innerHTML = `
    <input type="hidden" class="edit-var-id" value="${variant?.id || ''}">
    <input type="text" placeholder="Talle (Ej: M)" value="${variant?.size || ''}" class="edit-var-size w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="text" placeholder="Color (Ej: Negro)" value="${variant?.color || ''}" class="edit-var-color w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="number" placeholder="Stock" value="${variant?.stock ?? ''}" class="edit-var-stock w-1/4 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <button onclick="document.getElementById('${rowId}').remove()" class="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-red-400 bg-slate-800 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 rounded-lg transition">&times;</button>
  `;
  container.appendChild(div);
};

window.updateProduct = async () => {
  const id = document.getElementById("editPId").value;
  const name = document.getElementById("editPName").value.trim();
  const price = document.getElementById("editPPrice").value;
  const image_url = document.getElementById("editPImageUrl").value.trim() || null;
  const btn = document.getElementById("btnUpdateProduct");

  if (!name || !price) { showAlert('Campos requeridos', 'Completá el nombre y el precio del producto.', 'warning'); return; }

  btn.innerText = "Guardando...";
  btn.disabled = true;

  const { error: prodError } = await supabase
    .from("products")
    .update({ name, price, image_url })
    .eq("id", id);

  if (prodError) {
    btn.innerText = "Guardar cambios";
    btn.disabled = false;
    showAlert('Error al actualizar', 'No se pudo actualizar el producto. Intentá de nuevo.', 'error');
    return;
  }

  const rows = document.querySelectorAll(".edit-variant-row");
  const toUpsert = [];
  const toInsert = [];

  rows.forEach(row => {
    const varId = row.querySelector(".edit-var-id").value;
    const size = row.querySelector(".edit-var-size").value.trim();
    const color = row.querySelector(".edit-var-color").value.trim();
    const stock = parseInt(row.querySelector(".edit-var-stock").value) || 0;
    if (!size && !color) return;
    if (varId) {
      toUpsert.push({ id: varId, product_id: id, size, color, stock });
    } else {
      toInsert.push({ product_id: id, size, color, stock });
    }
  });

  if (toUpsert.length > 0) {
    await supabase.from("variants").upsert(toUpsert);
  }
  if (toInsert.length > 0) {
    await supabase.from("variants").insert(toInsert);
  }

  const prod = products.find(p => p.id === id);
  if (prod) {
    const keptIds = toUpsert.map(v => v.id);
    const toDelete = prod.variants.filter(v => !keptIds.includes(v.id)).map(v => v.id);
    if (toDelete.length > 0) {
      await supabase.from("variants").delete().in("id", toDelete);
    }
  }

  btn.innerText = "Guardar cambios";
  btn.disabled = false;
  closeEditProductModal();
  loadProducts();
};

// ==========================================
// 7. PREVIEW DE IMÁGENES
// ==========================================
function setupImagePreview(inputId, previewId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;
  input.addEventListener("input", () => {
    const url = input.value.trim();
    if (url) {
      preview.innerHTML = `<img src="${url}" class="w-full h-full object-cover rounded-lg" onerror="this.parentElement.innerHTML='<svg class=\\'w-5 h-5 text-slate-600\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg>'">`;
    } else {
      preview.innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
    }
  });
}
setupImagePreview("pImageUrl", "pImagePreview");
setupImagePreview("editPImageUrl", "editPImagePreview");
setupImagePreview("confLogo", "confLogoPreview");

// ==========================================
// 8. MÓDULO VENTAS (Historial)
// ==========================================
let allSales = [];
let salesPeriod = 'today';

window.setSalesPeriod = (period) => {
  salesPeriod = period;
  document.querySelectorAll('.sales-period-btn').forEach(btn => {
    btn.className = 'sales-period-btn px-3 py-1.5 rounded-md text-slate-400 hover:text-white transition-all';
  });
  const activeBtn = document.getElementById(`filter-${period}`);
  if (activeBtn) activeBtn.className = 'sales-period-btn px-3 py-1.5 rounded-md bg-indigo-500 text-white transition-all';
  applySalesFilters();
};

window.applySalesFilters = () => {
  const paymentFilter = document.getElementById("salesPaymentFilter")?.value || '';
  const now = new Date();
  const AR_TZ = 'America/Argentina/Buenos_Aires';

  // Helper: get YYYY-MM-DD string in Argentina timezone
  const toARDate = (d) => d.toLocaleDateString('en-CA', { timeZone: AR_TZ }); // en-CA gives YYYY-MM-DD
  const todayAR = toARDate(now);

  let filtered = allSales.filter(sale => {
    const rawTs = sale.created_at.endsWith('Z') || sale.created_at.includes('+') ? sale.created_at : sale.created_at + 'Z';
    const saleDate = new Date(rawTs);

    if (salesPeriod === 'today') {
      if (toARDate(saleDate) !== todayAR) return false;
    } else if (salesPeriod === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      if (saleDate < weekAgo) return false;
    } else if (salesPeriod === 'month') {
      const saleDateAR = saleDate.toLocaleDateString('es-AR', { timeZone: AR_TZ, month: 'numeric', year: 'numeric' });
      const nowDateAR = now.toLocaleDateString('es-AR', { timeZone: AR_TZ, month: 'numeric', year: 'numeric' });
      if (saleDateAR !== nowDateAR) return false;
    }

    if (paymentFilter && sale.payment_method !== paymentFilter) return false;
    return true;
  });

  renderSalesKPIs(filtered);
  renderSalesList(filtered);
};

function renderSalesKPIs(sales) {
  const count = sales.length;
  const total = sales.reduce((s, v) => s + Number(v.total), 0);
  const avg = count > 0 ? total / count : 0;
  const units = sales.reduce((s, v) => {
    const qty = (v.sale_items || []).reduce((a, i) => a + (i.quantity || 0), 0);
    return s + qty;
  }, 0);

  document.getElementById("kpi-count").innerText = count;
  document.getElementById("kpi-total").innerText = `$${total.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  document.getElementById("kpi-avg").innerText = `$${avg.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  document.getElementById("kpi-units").innerText = units;
}

function renderSalesList(sales) {
  const list = document.getElementById("salesList");
  const emptyState = document.getElementById("salesEmptyState");
  const header = document.getElementById("salesTableHeader");
  list.innerHTML = "";

  if (sales.length === 0) {
    emptyState.classList.remove("hidden");
    emptyState.classList.add("flex");
    header.classList.add("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  emptyState.classList.remove("flex");
  header.classList.remove("hidden");

  const paymentIcons = {
    'Efectivo': `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 002-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>`,
    'Transferencia': `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>`,
    'Tarjeta de Débito': `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>`,
    'Tarjeta de Crédito': `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path></svg>`,
    'Otros': `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"></path></svg>`,
  };
  const paymentColors = {
    'Efectivo': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    'Transferencia': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    'Tarjeta de Débito': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'Tarjeta de Crédito': 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    'Otros': 'text-slate-300 bg-slate-500/10 border-slate-500/20',
  };

  sales.forEach((sale, idx) => {
    // Forzar parseo UTC: Supabase a veces devuelve sin Z, haciendo que new Date() lo tome como hora local
    const rawTs = sale.created_at.endsWith('Z') || sale.created_at.includes('+') ? sale.created_at : sale.created_at + 'Z';
    const date = new Date(rawTs);
    const tzOptions = { timeZone: 'America/Argentina/Buenos_Aires' };
    const dateStr = date.toLocaleDateString('es-AR', { ...tzOptions, day: '2-digit', month: '2-digit', year: '2-digit' });
    const timeStr = date.toLocaleTimeString('es-AR', { ...tzOptions, hour: '2-digit', minute: '2-digit', hour12: false });
    const items = sale.sale_items || [];
    const totalUnits = items.reduce((s, i) => s + (i.quantity || 0), 0);
    const method = sale.payment_method || 'N/A';
    const methodColor = paymentColors[method] || 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    const methodIcon = paymentIcons[method] || '';
    const rowId = `sale-row-${sale.id}`;
    const detailId = `sale-detail-${sale.id}`;

    const itemsHtml = items.length > 0
      ? items.map(item => {
          const variantLabel = [item.variants?.size, item.variants?.color].filter(Boolean).join(' · ');
          const productName = item.variants?.products?.name || 'Producto';
          return `
            <div class="flex items-center justify-between py-1.5 text-xs">
              <div class="flex items-center gap-2">
                <span class="w-5 h-5 bg-slate-800 rounded flex items-center justify-center text-[9px] font-bold text-slate-400">${item.quantity}</span>
                <span class="text-slate-300">${productName}</span>
                ${variantLabel ? `<span class="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">${variantLabel}</span>` : ''}
              </div>
              <span class="text-slate-400 font-medium">$${Number(item.price).toLocaleString('es-AR')}</span>
            </div>`;
        }).join('')
      : `<p class="text-xs text-slate-600 py-2">Sin detalle disponible.</p>`;

    const row = document.createElement("div");
    row.innerHTML = `
      <div id="${rowId}" class="hidden md:grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-800/40 transition-colors cursor-pointer group" onclick="toggleSaleDetail('${sale.id}')">
        <span class="col-span-1 text-xs font-bold text-slate-600">#${idx + 1}</span>
        <div class="col-span-3">
          <p class="text-xs font-semibold text-white">${dateStr}</p>
          <p class="text-[10px] text-slate-500">${timeStr}</p>
        </div>
        <div class="col-span-3">
          <span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border ${methodColor}">
            ${methodIcon} ${method}
          </span>
        </div>
        <span class="col-span-2 text-xs text-slate-300">${totalUnits} u.</span>
        <span class="col-span-2 text-right text-sm font-bold text-white">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
        <div class="col-span-1 flex justify-end">
          <svg id="chevron-${sale.id}" class="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <div class="md:hidden flex items-center justify-between px-4 py-3 cursor-pointer active:bg-slate-800/40 transition" onclick="toggleSaleDetail('${sale.id}')">
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-[10px] font-bold text-slate-600 flex-shrink-0">#${idx + 1}</span>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-white">${dateStr} <span class="text-slate-500 font-normal">${timeStr}</span></p>
            <span class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${methodColor} mt-0.5">
              ${methodIcon} ${method}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-sm font-black text-white">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
          <svg id="chevron-${sale.id}-m" class="w-4 h-4 text-slate-600 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <div id="${detailId}" class="hidden px-4 pb-4 pt-1 bg-slate-800/20 border-t border-slate-800/50">
        <div class="bg-slate-900/80 rounded-lg p-3 border border-slate-800">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Detalle de ítems</p>
          <div class="divide-y divide-slate-800/50">${itemsHtml}</div>
          <div class="flex justify-between items-center mt-3 pt-2.5 border-t border-slate-700">
            <span class="text-xs text-slate-400">Total</span>
            <div class="flex items-center gap-3">
              <button onclick="reprintTicket('${sale.id}')" class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg transition-all">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                Ver ticket
              </button>
              <span class="text-sm font-black text-indigo-400">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    list.appendChild(row);
  });
}

window.toggleSaleDetail = (saleId) => {
  const detail = document.getElementById(`sale-detail-${saleId}`);
  const chevron = document.getElementById(`chevron-${saleId}`);
  const chevronM = document.getElementById(`chevron-${saleId}-m`);
  if (!detail) return;

  const isHidden = detail.classList.contains("hidden");
  detail.classList.toggle("hidden", !isHidden);

  const rotate = isHidden ? "rotate(180deg)" : "rotate(0deg)";
  if (chevron) chevron.style.transform = rotate;
  if (chevronM) chevronM.style.transform = rotate;
};

async function loadSales() {
  const loadingEl = document.getElementById("salesLoadingState");
  if (loadingEl) loadingEl.classList.remove("hidden");

  const { data, error } = await supabase
    .from("sales")
    .select(`
      *,
      sale_items (
        id, quantity, price,
        variants (
          id, size, color,
          products ( id, name )
        )
      )
    `)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (loadingEl) loadingEl.classList.add("hidden");

  if (error) {
    console.error("Error cargando ventas:", error);
    return;
  }

  allSales = data || [];
  applySalesFilters();
}

// ==========================================
// 9. MÓDULO CONFIGURACIÓN
// ==========================================
window.loadConfig = async () => {
  if (!storeId) return;

  const { data: store, error } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single();

  if (error || !store) { console.error("loadConfig error:", error); return; }
  currentStore = store;

  const expiresAt = new Date(store.expires_at);
  const now = new Date();
  const daysLeft = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));

  document.getElementById("configDaysLeft").innerText = daysLeft;
  const progressPercent = Math.min(100, (daysLeft / 30) * 100);
  const barColor = daysLeft <= 5 ? 'bg-red-500' : 'bg-emerald-500';
  document.getElementById("configProgressBar").className = `h-full rounded-full ${barColor}`;
  document.getElementById("configProgressBar").style.width = `${progressPercent}%`;

  document.getElementById("confLogo").value = store.logo_url || "";
  document.getElementById("confLogo").dispatchEvent(new Event('input'));
  document.getElementById("confPhone").value = store.phone || "";
  document.getElementById("confInstagram").value = store.instagram || "";
  document.getElementById("confAddress").value = store.address || "";
};

window.saveConfig = async () => {
  const btn = document.getElementById("btnSaveConfig");
  const originalText = btn.innerText;

  const logo_url = document.getElementById("confLogo").value.trim() || null;
  const phone = document.getElementById("confPhone").value.trim();
  const instagram = document.getElementById("confInstagram").value.trim();
  const address = document.getElementById("confAddress").value.trim();

  btn.innerText = "Guardando...";
  btn.disabled = true;

  const { error } = await supabase
    .from("stores")
    .update({ logo_url, phone, instagram, address })
    .eq("id", storeId);

  btn.innerText = originalText;
  btn.disabled = false;

  if (error) {
    console.error("saveConfig error:", error);
    showToast(error.message || "Error al guardar.", "error");
    return;
  }

  currentStore = { ...currentStore, logo_url, phone, instagram, address };
  showToast("Configuración guardada", "success");
};

window.logout = async () => {
  await supabase.auth.signOut();
  localStorage.removeItem("store_id");
  window.location.href = "index.html";
};

// ==========================================
// MODAL ALERT & CONFIRM
// ==========================================
function showAlert(title, message, type = 'warning') {
  const modal = document.getElementById('posAlertModal');
  document.getElementById('posAlertTitle').innerText = title;
  document.getElementById('posAlertMsg').innerText = message;

  const iconEl = document.getElementById('posAlertIcon');
  const configs = {
    warning: {
      wrap: 'bg-amber-500/10 border border-amber-500/20',
      svg: `<svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`
    },
    error: {
      wrap: 'bg-red-500/10 border border-red-500/20',
      svg: `<svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`
    },
    info: {
      wrap: 'bg-indigo-500/10 border border-indigo-500/20',
      svg: `<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
    }
  };
  const cfg = configs[type] || configs.warning;
  iconEl.className = `flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${cfg.wrap}`;
  iconEl.innerHTML = cfg.svg;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

window.closePosAlert = () => {
  const modal = document.getElementById('posAlertModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
};

let _confirmResolve = null;
function showConfirm(title, message) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('posConfirmTitle').innerText = title;
    document.getElementById('posConfirmMsg').innerText = message;
    const modal = document.getElementById('posConfirmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('posConfirmOkBtn').onclick = () => closePosConfirm(true);
  });
}

window.closePosConfirm = (result) => {
  const modal = document.getElementById('posConfirmModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'success') {
  const existing = document.getElementById('posToast');
  if (existing) existing.remove();
  const colors = {
    success: 'bg-emerald-500 border-emerald-400/50 text-white',
    error: 'bg-red-500 border-red-400/50 text-white',
  };
  const icons = {
    success: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>',
    error: '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>',
  };
  const toast = document.createElement('div');
  toast.id = 'posToast';
  toast.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-semibold ${colors[type]}`;
  toast.style.cssText = 'opacity:0;transform:translateY(8px);transition:opacity 0.25s,transform 0.25s';
  toast.innerHTML = `${icons[type]}<span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateY(0)'; });
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateY(8px)'; setTimeout(() => toast.remove(), 300); }, 3200);
}

// Start
initPos();
