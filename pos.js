import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://fxqomvjynncaigwoasqp.supabase.co";
const supabaseKey = "sb_publishable_Mwq88wTGFEHF9zvvM7xWmw_9FQmjlZO";
const supabase = createClient(supabaseUrl, supabaseKey);

// ===== CLOUDINARY CONFIG =====
const CLOUDINARY_CLOUD_NAME = "dmq1u3vdf";
const CLOUDINARY_UPLOAD_PRESET = "stockware_unsigned";

async function uploadToCloudinary(file, folder) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error("Error al subir imagen a Cloudinary");
  const data = await res.json();
  return data.secure_url;
}

// Sanitiza el nombre del archivo para usarlo como public_id
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '')
    .substring(0, 60) || 'imagen';
}
// ===== FIN CLOUDINARY =====

const storeId = localStorage.getItem("store_id");
let products = [];
let cart = [];
let currentSelectedProduct = null;
let currentStore = null;
let isSubscriptionActive = true;
let allSales = [];
let salesPeriod = 'today';
let currentCashSession = null; // Sesión de caja activa
let surchargePercent = 0; // Recargo activo (comisión posnet, no queda en caja)

const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('currentDateDisplay').innerText = new Intl.DateTimeFormat('es-AR', options).format(new Date());

// ===== RECARGO / COMISIÓN POSNET =====
// surchargePercent = porcentaje que se le cobra al cliente de más
// Ese monto NO queda en la caja propia, es la comisión del posnet/QR

window.toggleSurchargePanel = () => {
  const panel = document.getElementById('surchargePanel');
  const chevron = document.getElementById('surchargeChevron');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
};

window.setSurchargeQuick = (pct) => {
  const input = document.getElementById('surchargePercent');
  if (input) { input.value = pct; updateSurcharge(); }
};

window.setSurchargeQuickMobile = (pct) => {
  const input = document.getElementById('surchargePercentMobile');
  if (input) { input.value = pct; updateSurchargeMobile(); }
};

window.clearSurcharge = () => {
  const input = document.getElementById('surchargePercent');
  if (input) input.value = '';
  surchargePercent = 0;
  updateSurchargeUI();
  renderCart();
};

window.clearSurchargeMobile = () => {
  const input = document.getElementById('surchargePercentMobile');
  if (input) input.value = '';
  surchargePercent = 0;
  updateSurchargeUI();
  renderCart();
};

window.updateSurcharge = () => {
  const val = parseFloat(document.getElementById('surchargePercent')?.value) || 0;
  surchargePercent = Math.max(0, Math.min(val, 100));
  // Sincronizar con mobile
  const mobileInput = document.getElementById('surchargePercentMobile');
  if (mobileInput) mobileInput.value = surchargePercent || '';
  updateSurchargeUI();
  renderCart();
};

window.updateSurchargeMobile = () => {
  const val = parseFloat(document.getElementById('surchargePercentMobile')?.value) || 0;
  surchargePercent = Math.max(0, Math.min(val, 100));
  // Sincronizar con desktop
  const desktopInput = document.getElementById('surchargePercent');
  if (desktopInput) desktopInput.value = surchargePercent || '';
  updateSurchargeUI();
  renderCart();
};

function updateSurchargeUI() {
  const baseTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const surchargeAmt = Math.round(baseTotal * surchargePercent / 100);
  const finalTotal = baseTotal + surchargeAmt;

  // Badge del header
  const badge = document.getElementById('surchargePreviewBadge');
  if (badge) {
    if (surchargePercent > 0) {
      badge.textContent = `+${surchargePercent}%`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // Desglose en desktop
  const breakdown = document.getElementById('surchargeBreakdown');
  if (breakdown) {
    if (surchargePercent > 0 && baseTotal > 0) {
      breakdown.classList.remove('hidden');
      document.getElementById('surchargeBase').textContent = '$' + baseTotal.toLocaleString('es-AR');
      document.getElementById('surchargeAmount').textContent = '+$' + surchargeAmt.toLocaleString('es-AR');
      document.getElementById('surchargeFinalTotal').textContent = '$' + finalTotal.toLocaleString('es-AR');
    } else {
      breakdown.classList.add('hidden');
    }
  }
}
// ===== FIN RECARGO =====

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
    isSubscriptionActive = false;
    currentStore = store; // necesario para que generatePaymentLink tenga los datos de la tienda
    showSuspensionOverlay();
    return;
  }

  isSubscriptionActive = true;
  currentStore = store;
  document.getElementById("storeNameDisplay").innerText = store.name;
  loadProducts();
  loadPaymentMethods();

  // Verificar si hay caja abierta hoy; si no, mostrar aviso
  checkCashSessionOnStartup();
}

function showSuspensionOverlay() {
  const overlay = document.getElementById("suspensionOverlay");
  if (overlay) overlay.classList.remove("hidden");
  
  const mainContent = document.querySelector("main");
  if (mainContent) {
    mainContent.style.pointerEvents = "none";
    mainContent.style.opacity = "0.3";
  }

  // Generar QR automáticamente al mostrar el overlay
  setTimeout(() => fetchPaymentPreference(), 300);
}

function hideSuspensionOverlay() {
  const overlay = document.getElementById("suspensionOverlay");
  if (overlay) overlay.classList.add("hidden");
  
  const mainContent = document.querySelector("main");
  if (mainContent) {
    mainContent.style.pointerEvents = "";
    mainContent.style.opacity = "";
  }
}

// Verifica si hay caja abierta al iniciar; si no, muestra un banner sutil
async function checkCashSessionOnStartup() {
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('id, status, opened_at')
    .eq('store_id', storeId)
    .eq('status', 'abierta')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { console.error('checkCashSessionOnStartup error:', error); return; }

  if (!data) {
    showCashBanner();
  } else {
    currentCashSession = data;
    hideCashBanner();
  }
}

function showCashBanner() {
  const banner = document.getElementById('cashClosedBanner');
  if (banner) banner.classList.remove('hidden');
}

function hideCashBanner() {
  const banner = document.getElementById('cashClosedBanner');
  if (banner) banner.classList.add('hidden');
}

window.goToCashFromModal = () => {
  hideCashBanner();
  window.switchView('cash');
};

window.dismissCashRequired = () => {
  hideCashBanner();
};

window.copyText = (text) => {
  navigator.clipboard.writeText(text);
  showToast("Copiado al portapapeles", "success");
};

window.copyPaymentInfo = () => {
  const info = `DATOS DE PAGO STOCKWARE\n\nAlias: STOCKWARE.POS\nCBU: 0000003100076543210001\nMonto: $15.000\n\nEnviar comprobante a WhatsApp: +54 9 3644 539325`;
  navigator.clipboard.writeText(info);
  showToast("Datos de pago copiados", "success");
};

// Guarda el intervalo de polling para poder cancelarlo si es necesario
let _paymentPollingInterval = null;

async function fetchPaymentPreference() {
  if (!currentStore) return;

  const btn = document.getElementById("btnMercadoPago");
  const qrSpinner = document.getElementById("qrLoadingSpinner");
  const qrImage   = document.getElementById("qrCodeImage");
  const qrError   = document.getElementById("qrError");

  // Mostrar spinner, ocultar QR/error
  if (qrSpinner) qrSpinner.classList.remove("hidden");
  if (qrImage)  qrImage.classList.add("hidden");
  if (qrError)  qrError.classList.add("hidden");
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Generando...`; }

  try {
    const response = await fetch("https://delicate-shape-d593.leonelgalazzoaz.workers.dev/create-preference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: storeId,
        storeName: currentStore.name,
        email: currentStore.email
      })
    });

    const data = await response.json();

    if (data.init_point) {
      if (qrSpinner) qrSpinner.classList.add("hidden");

      const qrContainer = document.getElementById("qrCodeContainer");
      if (qrContainer && qrImage && typeof QRCode !== "undefined") {
        qrContainer.innerHTML = "";
        // qr_data = string EMV del instore API → reconocido por todas las apps de pago
        // Si no viene (error en el Worker), fallback al init_point
        const qrText = data.qr_data || data.init_point;
        try {
          new QRCode(qrContainer, {
            text: qrText,
            width: 144,
            height: 144,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
          });
          qrImage.classList.remove("hidden");
        } catch (qrErr) {
          console.error("Error generando QR:", qrErr);
          if (qrError) qrError.classList.remove("hidden");
        }
      } else {
        if (qrError) qrError.classList.remove("hidden");
      }

      // Botón para abrir el link manualmente como alternativa
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg> Abrir link de pago`;
        btn.onclick = () => window.open(data.init_point, "_blank");
      }

      // Iniciar polling para detectar el pago automáticamente
      startPaymentPolling(data.preference_id);

    } else {
      if (qrSpinner) qrSpinner.classList.add("hidden");
      if (qrError)  qrError.classList.remove("hidden");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `Reintentar`;
        btn.onclick = () => fetchPaymentPreference();
      }
      console.error("Error MP:", data.error);
    }

  } catch (error) {
    console.error("Error al generar pago:", error);
    if (qrSpinner) qrSpinner.classList.add("hidden");
    if (qrError)  qrError.classList.remove("hidden");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `Reintentar`;
      btn.onclick = () => fetchPaymentPreference();
    }
  }
}

// El botón del overlay llama a esta función (definida en el HTML como onclick="generatePaymentLink()")
window.generatePaymentLink = fetchPaymentPreference;

function startPaymentPolling(preferenceId) {
  // Cancelar polling anterior si existía
  if (_paymentPollingInterval) clearInterval(_paymentPollingInterval);

  let attempts = 0;
  _paymentPollingInterval = setInterval(async () => {
    attempts++;

    try {
      const response = await fetch(`https://delicate-shape-d593.leonelgalazzoaz.workers.dev/check-payment?preference_id=${preferenceId}&store_id=${storeId}`);
      const data = await response.json();

      if (data.status === "approved") {
        clearInterval(_paymentPollingInterval);
        _paymentPollingInterval = null;
        showAlert("¡Pago confirmado!", "Tu suscripción ha sido reactivada por 30 días. Gracias por confiar en Stockware.", "success");
        setTimeout(() => location.reload(), 3000);
      }
    } catch (e) {
      console.error("Error polling:", e);
    }

    if (attempts > 60) {
      clearInterval(_paymentPollingInterval);
      _paymentPollingInterval = null;
      showAlert("No se detectó el pago", "Si ya realizaste el pago, esperá unos minutos o contactá a soporte.", "warning");
    }
  }, 5000);
}

window.switchView = (view) => {
  document.getElementById("posView").classList.add("hidden");
  document.getElementById("productsView").classList.add("hidden");
  document.getElementById("salesView").classList.add("hidden");
  document.getElementById("cashView").classList.add("hidden");
  document.getElementById("configView").classList.add("hidden");
  document.getElementById("supportView").classList.add("hidden");
  
  document.getElementById(`${view}View`).classList.remove("hidden");

  const navIds = ['nav-pos', 'nav-products', 'nav-sales', 'nav-cash', 'nav-config', 'nav-support'];
  navIds.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.className = "w-full flex items-center gap-2.5 px-3 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm font-medium border border-transparent transition-all";
  });

  const activeEl = document.getElementById(`nav-${view}`);
  if(activeEl) {
    activeEl.className = "w-full flex items-center gap-2.5 px-3 py-2.5 bg-indigo-500/10 text-indigo-400 rounded-lg text-sm font-medium border border-indigo-500/20 transition-all";
  }

  if (view === "sales") loadSales();
  if (view === "config") { loadConfig(); setTimeout(loadPaperSizeUI, 50); }
  if (view === "cash") initCashView();
};

window.openWhatsApp = (message) => {
  window.open(`https://wa.me/5493644539325?text=${message}`, '_blank');
};

async function loadProducts() {
  const loading = document.getElementById("loadingProducts");
  if (loading) loading.classList.remove("hidden");

  const { data, error } = await supabase
    .from("products")
    .select(`*, variants (*)`)
    .eq("store_id", storeId)
    .order('created_at', { ascending: false });

  if (loading) loading.classList.add("hidden");

  if (error) {
    console.error(error);
    return;
  }

  products = data || [];
  renderPosGrid(products);
  renderProductsTable();
}

function renderPosGrid(productsToRender) {
  const grid = document.getElementById("productsGrid");
  grid.innerHTML = "";

  if (productsToRender.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center text-sm text-slate-500 mt-10">No se encontraron productos.</div>`;
    return;
  }

  productsToRender.forEach(prod => {
    const stockTotal = prod.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
    // Variante fantasma = único variant sin size y sin color (producto sin variantes reales)
    const isSimpleProduct = prod.variants.length === 1 && !prod.variants[0].size && !prod.variants[0].color;
    const hasRealVariants = prod.variants.length > 0 && !isSimpleProduct;

    const card = document.createElement("div");
    card.className = "bg-slate-800 border border-slate-700 hover:border-indigo-500/50 rounded-xl p-3 hover:shadow-[0_0_12px_rgba(99,102,241,0.15)] transition-all cursor-pointer flex flex-col justify-between group active:scale-95";
    card.onclick = () => hasRealVariants
      ? openVariantModal(prod.id)
      : addToCart(prod.id, isSimpleProduct ? prod.variants[0] : null);

    const imgHtml = prod.image_url
      ? `<img src="${prod.image_url}" alt="${prod.name}" class="w-full h-full object-contain p-1" onerror="this.parentElement.innerHTML='<svg class=\\'w-10 h-10\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.2\\' d=\\'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z\\'></path></svg>'">`
      : `<svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>`;
    
    card.innerHTML = `
      <div>
        <div class="w-full h-36 bg-slate-900 rounded-lg mb-3 flex items-center justify-center text-slate-700 group-hover:text-indigo-400 group-hover:bg-indigo-500/10 transition-colors duration-300 overflow-hidden">
           ${imgHtml}
        </div>
        <h3 class="font-semibold text-sm text-white leading-tight mb-0.5 truncate">${prod.name}</h3>
        ${prod.sku ? `<p class="text-[10px] text-slate-500 mb-1 font-mono truncate">${prod.sku}</p>` : '<div class="mb-1"></div>'}
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
  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(term) ||
    (p.sku && p.sku.toLowerCase().includes(term))
  );
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


window.closeSuccessModal = () => {
  document.getElementById("successModal").classList.add("hidden");
};

function addToCart(productId, variant) {
  if (!isSubscriptionActive) {
    showSuspensionOverlay();
    return;
  }
  
  const product = products.find(p => p.id === productId);
  if (!product) return;

// Verificar que haya stock antes de agregar
  if (variant && variant.stock <= 0) {
    showAlert('Sin stock', 'Este producto no tiene stock disponible.', 'warning');
    return;
  }

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
      sku: product.sku || null,
      price: product.price,
      size: variant ? variant.size : '',
      color: variant ? variant.color : '',
      qty: 1,
      currentStock: variant ? variant.stock : 0 
    });
  }
  renderCart();
}
window.copyTicketImage = async () => {
    const btn = document.getElementById("btnCopyImage");
    const originalHTML = btn.innerHTML;
    
    // Mostramos un estado de carga visual
    btn.innerHTML = `<span class="animate-pulse text-xs">Copiando...</span>`;
    btn.disabled = true;
    
    const ticketEl = document.getElementById("ticketCaptureArea");
    
    try {
        // Generamos el canvas igual que en la descarga
        const canvas = await html2canvas(ticketEl, {
            scale: 3,
            backgroundColor: "#FFFFFF",
            useCORS: true,
            allowTaint: true,
            logging: false
        });

        // Convertimos el canvas a un Blob (archivo binario en memoria)
        canvas.toBlob(async (blob) => {
            try {
                // Escribimos el blob en el portapapeles
                const item = new ClipboardItem({ "image/png": blob });
                await navigator.clipboard.write([item]);
                
                showToast("¡Imagen copiada! ", "success");
            } catch (err) {
                console.error("Error al copiar al portapapeles:", err);
                showToast("Tu navegador no permite copiar imágenes. Usá descargar.", "warning");
            } finally {
                // Restauramos el botón
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        }, "image/png");

    } catch (e) {
        console.error("Error generando ticket:", e);
        showToast("Error al generar la imagen", "error");
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
};
function renderCart() {
  const container = document.getElementById("cartItems");
  const mobileContainer = document.getElementById("mobileCartItems");
  const subtotalSpan = document.getElementById("subtotalDisplay");
  const totalSpan = document.getElementById("totalDisplay");
  const mobileTotalSpan = document.getElementById("mobileTotalDisplay");
  const mobileCartCount = document.getElementById("mobileCartCount");
  const cartBadge = document.getElementById("cartBadge");

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

  const baseTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const surchargeAmt = surchargePercent > 0 ? Math.round(baseTotal * surchargePercent / 100) : 0;
  const total = baseTotal + surchargeAmt;

  const formatted = `$${total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;
  const baseFormatted = `$${baseTotal.toLocaleString('es-AR', { minimumFractionDigits: 0 })}`;

  if (subtotalSpan) subtotalSpan.innerText = baseFormatted;
  if (totalSpan) totalSpan.innerText = formatted;
  if (mobileTotalSpan) mobileTotalSpan.innerText = formatted;
  if (mobileCartCount) mobileCartCount.innerText = `${totalItems} item${totalItems !== 1 ? 's' : ''}`;
  if (cartBadge) {
    cartBadge.innerText = totalItems > 9 ? '9+' : totalItems;
    cartBadge.style.display = "flex";
    cartBadge.classList.add('pulse-once');
    setTimeout(() => cartBadge.classList.remove('pulse-once'), 400);
  }
  updateSurchargeUI();
  updateCheckoutBtn();
}

function updateCheckoutBtn() {
  const btns = [
    document.getElementById('btnCheckout'),
    document.getElementById('btnCheckoutMobile'),
  ];
  btns.forEach(btn => {
    if (!btn) return;
    if (cart.length > 0 && isSubscriptionActive) {
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
  const mobilePay = document.getElementById("paymentMethodMobile");
  const desktopPay = document.getElementById("paymentMethod");
  if (mobilePay && desktopPay) desktopPay.value = mobilePay.value;
  await checkout();
};

window.checkout = async () => {
  if (cart.length === 0) return;
  if (!isSubscriptionActive) {
    showSuspensionOverlay();
    return;
  }

  const btn = document.getElementById("btnCheckout");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Procesando...`;

  const baseTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const surchargeAmt = surchargePercent > 0 ? Math.round(baseTotal * surchargePercent / 100) : 0;
  const totalWithSurcharge = baseTotal + surchargeAmt;
  const selectedPaymentMethod = document.getElementById("paymentMethod").value;

  // En la BD guardamos el total SIN recargo (lo que realmente te queda)
  // El recargo es comisión del posnet, no es ingreso tuyo
  const salePayload = {
    store_id: storeId,
    total: baseTotal,
    payment_method: selectedPaymentMethod,
  };

  // Guardar el recargo si existe (para registro/auditoría)
  if (surchargeAmt > 0) {
    salePayload.surcharge_percent = surchargePercent;
    salePayload.surcharge_amount = surchargeAmt;
  }

  // Si hay una sesión de caja activa, vincular la venta
  if (currentCashSession?.id) {
    salePayload.session_id = currentCashSession.id;
  }

  const { data: saleData, error: saleError } = await supabase
    .from("sales")
    .insert(salePayload)
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
  
  renderTicketPreview(saleData, cart, selectedPaymentMethod, totalWithSurcharge, surchargeAmt);
  document.getElementById("successModal").classList.remove("hidden");
  if (typeof closeMobileCart === 'function') closeMobileCart();
  
  btn.disabled = false;
  btn.innerHTML = "Finalizar compra";

  // Limpiar recargo después de la venta
  surchargePercent = 0;
  const dInput = document.getElementById('surchargePercent');
  const mInput = document.getElementById('surchargePercentMobile');
  if (dInput) dInput.value = '';
  if (mInput) mInput.value = '';

  cart = [];
  renderCart();
  loadProducts(); 
};

function renderTicketPreview(sale, cartItems, method, totalWithSurcharge, surchargeAmt) {
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
    
    // Factor de recargo: distribuye el recargo proporcionalmente en cada ítem
    const surchargeFactor = (totalWithSurcharge && surchargeAmt > 0)
        ? totalWithSurcharge / (totalWithSurcharge - surchargeAmt)
        : 1;

    cartItems.forEach(item => {
        const variantLabel = (item.size || item.color) ? ` (${item.size||''} ${item.color||''})`.trim() : '';
        const itemTotal = Math.round(item.price * item.qty * surchargeFactor);
        itemsContainer.innerHTML += `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px;">
                <div style="flex:1;padding-right:8px;line-height:1.35;">
                    <div><span style="font-weight:700;">${item.qty}x</span> ${item.name}${variantLabel}</div>
                    ${item.sku ? `<div style="font-size:10px;color:#888;font-family:monospace;margin-top:2px;letter-spacing:0.03em;">${item.sku}</div>` : ''}
                </div>
                <div style="font-weight:700;white-space:nowrap;">
                    $${itemTotal.toLocaleString('es-AR')}
                </div>
            </div>
        `;
    });

    document.getElementById("tkTotal").innerText = "$" + Number(totalWithSurcharge || sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 });
}

window.setPaperSize = (size) => {
    localStorage.setItem("pos_paper_size", size);
    loadPaperSizeUI();
};

window.loadPaperSizeUI = () => {
    const size = localStorage.getItem("pos_paper_size") || "80mm";
    const map = { "58mm": "paperBtn58", "80mm": "paperBtn80", "A4": "paperBtnA4" };
    Object.entries(map).forEach(([s, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (s === size) {
            btn.classList.remove("border-slate-700", "text-slate-400");
            btn.classList.add("border-indigo-500", "text-white", "bg-indigo-500/10");
        } else {
            btn.classList.remove("border-indigo-500", "text-white", "bg-indigo-500/10");
            btn.classList.add("border-slate-700", "text-slate-400");
        }
    });
};

window.printTicket = () => {
    const ticketHtml = document.getElementById("ticketCaptureArea").innerHTML;
    const paperSize = localStorage.getItem("pos_paper_size") || "80mm";
    const paperW = paperSize === "A4" ? "210mm" : paperSize;
    const paperPad = paperSize === "A4" ? "20mm 25mm" : "8px 10px";
    const paperFont = paperSize === "58mm" ? "10px" : "11px";
    const printWindow = window.open('', '', 'width=400,height=600');
    printWindow.document.write(`
        <html>
            <head>
                <title>Imprimir Ticket</title>
                <style>
                    @page { size: ${paperW} auto; margin: 0; }
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
                        font-size: ${paperFont};
                        line-height: 1.5;
                        color: #111;
                        background: #fff;
                        width: ${paperW};
                        max-width: ${paperW};
                    }

                    /* === Ticket container === */
                    #ticketCaptureArea {
                        width: 100% !important;
                        filter: none !important;
                        box-shadow: none !important;
                        border-radius: 0 !important;
                    }

                    /* Bordes dentados — override inline gradients for print */
                    #ticketCaptureArea > div:first-child,
                    #ticketCaptureArea > div:last-child {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }

                    /* Cuerpo */
                    #ticketCaptureArea > div:nth-child(2) {
                        padding: 0 ${paperSize === '58mm' ? '14px' : '18px'} !important;
                    }

                    /* Logo */
                    #tkLogoWrapper { display: flex !important; justify-content: center; }
                    #tkLogoWrapper.hidden { display: none !important; }
                    #tkLogo {
                        max-height: 50px !important;
                        max-width: 120px !important;
                        object-fit: contain;
                        display: block;
                        margin: 0 auto;
                    }

                    /* Nombre */
                    #tkStoreName {
                        font-size: ${paperSize === '58mm' ? '13px' : '15px'} !important;
                        font-weight: 800 !important;
                        letter-spacing: 0.12em;
                        color: #111 !important;
                    }
                    #tkStoreContact { font-size: 10px !important; color: #555 !important; }
                    #tkStoreAddress { font-size: 9.5px !important; color: #888 !important; }

                    /* Datos */
                    #tkDate, #tkId, #tkPayment {
                        font-size: 11px !important;
                        color: #111 !important;
                    }

                    /* Ítems */
                    #tkItems div { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; }

                    /* Total */
                    #tkTotal {
                        font-size: ${paperSize === '58mm' ? '15px' : '17px'} !important;
                        font-weight: 800 !important;
                        color: #111 !important;
                    }

                    /* Utilidades */
                    .hidden { display: none !important; }
                    .flex { display: flex; }
                </style>
            </head>
            <body>${ticketHtml}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    // Esperar a que Tailwind cargue y renderice antes de imprimir
    printWindow.onload = () => {
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 600);
    };
    // Fallback por si onload ya disparó
    setTimeout(() => {
        if (!printWindow.closed) {
            printWindow.print();
            printWindow.close();
        }
    }, 2000);
};

window.reprintTicket = (saleId) => {
    const sale = allSales.find(s => s.id === saleId);
    if (!sale) return;

    const cartItems = (sale.sale_items || []).map(item => ({
        name: item.variants?.products?.name || 'Producto',
        sku: item.variants?.products?.sku || null,
        size: item.variants?.size || '',
        color: item.variants?.color || '',
        qty: item.quantity,
        price: item.price,
    }));

    renderTicketPreview(sale, cartItems, sale.payment_method,
      (sale.surcharge_amount ? sale.total + sale.surcharge_amount : sale.total),
      sale.surcharge_amount || 0
    );

    const closeBtn = document.getElementById("btnSuccessClose");
    if (closeBtn) {
        closeBtn.innerText = "Cerrar";
        closeBtn.onclick = () => {
            document.getElementById("successModal").classList.add("hidden");
            closeBtn.innerText = "Cerrar";
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
        <h3 class="font-semibold text-sm text-white leading-tight mb-0.5 truncate">${prod.name}</h3>
        ${prod.sku ? `<p class="text-[10px] text-slate-500 font-mono mb-1 truncate">${prod.sku}</p>` : '<div class="mb-1"></div>'}
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
  const get = (id) => document.getElementById(id);
  if (!get("addProductModal")) return; // DOM no listo aún
  get("pName").value = "";
  get("pPrice").value = "";
  if (get("pSku")) get("pSku").value = "";
  get("pStock").value = "";
  get("pImageUrl").value = "";
  if (get("pImageFile")) get("pImageFile").value = "";
  if (get("pImageLabel")) get("pImageLabel").textContent = "Seleccionar imagen...";
  get("pImagePreview").innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
  get("variantsContainer").innerHTML = "";
  // Mostrar stock simple al inicio (sin variantes)
  get("pStockWrapper").classList.remove("hidden");
  get("addProductModal").classList.remove("hidden");
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
    <input type="text" placeholder="Variante (Ej: Talle M, 42, Único)" class="var-size w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="text" placeholder="Detalle (Ej: Negro, Rojo, Cuero)" class="var-color w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="number" placeholder="Stock" class="var-stock w-1/4 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <button onclick="removeVariantRow('${rowId}')" class="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-red-400 bg-slate-800 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 rounded-lg transition">&times;</button>
  `;
  container.appendChild(div);
  // Ocultar stock simple mientras haya variantes
  document.getElementById("pStockWrapper").classList.add("hidden");
};

// Eliminar fila de variante y mostrar stock simple si ya no hay ninguna
window.removeVariantRow = (rowId) => {
  document.getElementById(rowId).remove();
  const remaining = document.querySelectorAll('.variant-row');
  if (remaining.length === 0) {
    document.getElementById("pStockWrapper").classList.remove("hidden");
  }
};

window.saveProduct = async () => {
  const name = document.getElementById("pName").value.trim();
  const price = document.getElementById("pPrice").value;
  const sku = (document.getElementById("pSku")?.value || "").trim() || null;
  const btn = document.getElementById("btnSaveProduct");
  
  if (!name || !price) { showAlert('Campos requeridos', 'Completá el nombre y el precio base del producto.', 'warning'); return; }

  // Subir imagen a Cloudinary si hay archivo seleccionado
  let image_url = document.getElementById("pImageUrl").value.trim() || null;
  const imageFile = document.getElementById("pImageFile")?.files?.[0];
  if (imageFile) {
    btn.innerText = "Subiendo imagen...";
    btn.disabled = true;
    try {
      const productSlug = sanitizeFilename(name || 'producto');
      const folder = `stockware/store_${storeId}/productos`;
      image_url = await uploadToCloudinary(imageFile, folder);
    } catch (e) {
      btn.innerText = "Guardar";
      btn.disabled = false;
      showAlert('Error de imagen', 'No se pudo subir la imagen. Intentá de nuevo.', 'error');
      return;
    }
  }

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

  

  btn.innerText = "Guardando...";
  btn.disabled = true;

  const { data: newProduct, error: prodError } = await supabase
    .from("products")
    .insert([{ store_id: storeId, name, price, image_url, sku }])
    .select().single();

  if (prodError) {
    btn.innerText = "Guardar";
    btn.disabled = false;
    showAlert('Error al guardar', 'No se pudo crear el producto en la base de datos. Intentá de nuevo.', 'error');
    return;
  }

  // Si no hay variantes, crear una variante fantasma con el stock general
  if (variantsData.length === 0) {
    const simpleStock = parseInt(document.getElementById("pStock").value) || 0;
    variantsData.push({ size: '', color: '', stock: simpleStock });
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

window.openEditProductModal = (productId) => {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  const _g = (id) => document.getElementById(id);
  _g("editPId").value = prod.id;
  _g("editPName").value = prod.name;
  _g("editPPrice").value = prod.price;
  if (_g("editPSku")) _g("editPSku").value = prod.sku || "";
  
  const imgUrl = prod.image_url || '';
  document.getElementById("editPImageUrl").value = imgUrl;
  // Resetear file input
  const editFileInput = document.getElementById("editPImageFile");
  if (editFileInput) editFileInput.value = "";
  const editLabel = document.getElementById("editPImageLabel");
  if (editLabel) editLabel.textContent = imgUrl ? "Imagen actual (subir nueva para cambiar)" : "Seleccionar imagen...";
  const preview = document.getElementById("editPImagePreview");
  if (imgUrl) {
    preview.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover rounded-lg" onerror="this.parentElement.innerHTML='<svg class=\\'w-5 h-5 text-slate-600\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg>'">`;
  } else {
    preview.innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
  }

  const container = document.getElementById("editVariantsContainer");
  container.innerHTML = "";

  // Detectar si es producto simple (variante fantasma: sin size ni color)
  const isSimple = prod.variants.length === 1 && !prod.variants[0].size && !prod.variants[0].color;
  const stockWrapper = document.getElementById("editPStockWrapper");
  const stockInput = document.getElementById("editPStock");

  if (isSimple) {
    // Mostrar campo de stock simple, no mostrar la fila de variante
    stockWrapper.classList.remove("hidden");
    stockInput.value = prod.variants[0].stock ?? '';
    // Guardar el id de la variante fantasma para poder actualizarla
    stockInput.dataset.variantId = prod.variants[0].id;
  } else {
    stockWrapper.classList.add("hidden");
    stockInput.value = '';
    stockInput.dataset.variantId = '';
    prod.variants.forEach(v => addEditVariantRow(v));
  }

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
    <input type="text" placeholder="Variante (Ej: Talle M, 42, Único)" value="${variant?.size || ''}" class="edit-var-size w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="text" placeholder="Detalle (Ej: Negro, Rojo, Cuero)" value="${variant?.color || ''}" class="edit-var-color w-1/3 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <input type="number" placeholder="Stock" value="${variant?.stock ?? ''}" class="edit-var-stock w-1/4 p-2 bg-slate-800 border border-slate-700 text-white rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-500">
    <button onclick="removeEditVariantRow('${rowId}')" class="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-red-400 bg-slate-800 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/30 rounded-lg transition">&times;</button>
  `;
  container.appendChild(div);
  // Si se agrega una variante real, ocultar el campo de stock simple
  document.getElementById("editPStockWrapper").classList.add("hidden");
};

// Eliminar fila variante en edición; si no quedan más, mostrar stock simple
window.removeEditVariantRow = (rowId) => {
  document.getElementById(rowId).remove();
  const remaining = document.querySelectorAll('.edit-variant-row');
  if (remaining.length === 0) {
    document.getElementById("editPStockWrapper").classList.remove("hidden");
  }
};

window.updateProduct = async () => {
  const id = document.getElementById("editPId").value;
  const name = document.getElementById("editPName").value.trim();
  const price = document.getElementById("editPPrice").value;
  const sku = (document.getElementById("editPSku")?.value || "").trim() || null;
  let image_url = document.getElementById("editPImageUrl").value.trim() || null;
  const btn = document.getElementById("btnUpdateProduct");

  if (!name || !price) { showAlert('Campos requeridos', 'Completá el nombre y el precio del producto.', 'warning'); return; }

  // Subir imagen a Cloudinary si hay archivo nuevo seleccionado
  const imageFile = document.getElementById("editPImageFile")?.files?.[0];
  if (imageFile) {
    btn.innerText = "Subiendo imagen...";
    btn.disabled = true;
    try {
      const folder = `stockware/store_${storeId}/productos`;
      image_url = await uploadToCloudinary(imageFile, folder);
    } catch (e) {
      btn.innerText = "Guardar cambios";
      btn.disabled = false;
      showAlert('Error de imagen', 'No se pudo subir la imagen. Intentá de nuevo.', 'error');
      return;
    }
  }

  btn.innerText = "Guardando...";
  btn.disabled = true;

  const { error: prodError } = await supabase
    .from("products")
    .update({ name, price, image_url, sku })
    .eq("id", id);

  if (prodError) {
    btn.innerText = "Guardar cambios";
    btn.disabled = false;
    showAlert('Error al actualizar', 'No se pudo actualizar el producto. Intentá de nuevo.', 'error');
    return;
  }

  const rows = document.querySelectorAll(".edit-variant-row");
  const stockInput = document.getElementById("editPStock");
  const isSimpleMode = !document.getElementById("editPStockWrapper").classList.contains("hidden");

  if (isSimpleMode) {
    // Producto sin variantes: actualizar o crear la variante fantasma
    const simpleStock = parseInt(stockInput.value) || 0;
    const phantomId = stockInput.dataset.variantId;
    if (phantomId) {
      // Ya existe la variante fantasma → actualizarla
      await supabase.from("variants").update({ stock: simpleStock, size: '', color: '' }).eq("id", phantomId);
    } else {
      // No existe → crearla (caso: producto tenía variantes reales y se quitaron todas)
      const prod = products.find(p => p.id === id);
      if (prod) {
        const allIds = prod.variants.map(v => v.id);
        if (allIds.length > 0) await supabase.from("variants").delete().in("id", allIds);
      }
      await supabase.from("variants").insert({ product_id: id, size: '', color: '', stock: simpleStock });
    }
  } else {
    // Producto con variantes reales
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
  }

  btn.innerText = "Guardar cambios";
  btn.disabled = false;
  closeEditProductModal();
  loadProducts();
};

// ===== HANDLERS DE SELECCIÓN DE IMAGEN (file input) =====

// Muestra preview local al seleccionar archivo (sin subir aún)
window.handleProductImageSelect = (input, labelId, previewId) => {
  const file = input.files?.[0];
  if (!file) return;
  const label = document.getElementById(labelId);
  const preview = document.getElementById(previewId);
  if (label) label.textContent = file.name;
  if (preview) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" class="w-full h-full object-cover rounded-lg">`;
  }
};

// Logo: igual que producto
window.handleLogoSelect = (input) => {
  const file = input.files?.[0];
  if (!file) return;
  const label = document.getElementById('confLogoLabel');
  const preview = document.getElementById('confLogoPreview');
  if (label) label.textContent = file.name;
  if (preview) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" class="w-full h-full object-contain rounded-lg p-0.5">`;
  }
};

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

  const toARDate = (d) => d.toLocaleDateString('en-CA', { timeZone: AR_TZ });
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

function setSalesState(state) {
  // state: 'loading' | 'empty' | 'data'
  const loading = document.getElementById("salesLoadingState");
  const empty   = document.getElementById("salesEmptyState");
  const wrapper = document.getElementById("salesTableWrapper");
  const header  = document.getElementById("salesTableHeader");

  [loading, empty, wrapper].forEach(el => { if (el) el.classList.add("hidden"); });

  if (state === 'loading' && loading) {
    loading.classList.remove("hidden");
  } else if (state === 'empty' && empty) {
    empty.classList.remove("hidden");
    if (header) header.classList.add("hidden");
  } else if (state === 'data' && wrapper) {
    wrapper.classList.remove("hidden");
    if (header) header.classList.remove("hidden");
  }
}

function renderSalesList(sales) {
  const list = document.getElementById("salesList");
  list.innerHTML = "";

  if (sales.length === 0) {
    setSalesState('empty');
    return;
  }

  setSalesState('data');

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
      <div class="hidden md:grid grid-cols-12 px-4 py-3.5 items-center hover:bg-slate-800/40 transition-colors cursor-pointer group" onclick="toggleSaleDetail('${sale.id}')">
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
        <div class="col-span-2 flex items-center justify-end gap-2">
          ${sale.status === 'anulada' ? '<span class="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded">ANULADA</span>' : ''}
          <span class="text-sm font-bold ${sale.status === 'anulada' ? 'text-slate-500 line-through' : 'text-white'}">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
        </div>
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
          ${sale.status === 'anulada' ? '<span class="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded flex-shrink-0">ANULADA</span>' : ''}
          <span class="text-sm font-black ${sale.status === 'anulada' ? 'text-slate-500 line-through' : 'text-white'}">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
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
              ${sale.status === 'anulada'
                ? `<span class="flex items-center gap-1.5 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-lg">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    ANULADA
                  </span>`
                : `<button onclick="anularVenta('${sale.id}')" class="flex items-center gap-1.5 text-[11px] font-semibold text-red-400 hover:text-white hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 px-2.5 py-1.5 rounded-lg transition-all">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    Anular
                  </button>`
              }
              <button onclick="reprintTicket('${sale.id}')" class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg transition-all">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                Ver ticket
              </button>
              <span class="text-sm font-black ${sale.status === 'anulada' ? 'text-slate-500 line-through' : 'text-indigo-400'}">$${Number(sale.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
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
  setSalesState('loading');

  const { data, error } = await supabase
    .from("sales")
    .select(`
      *,
      sale_items (
        id, quantity, price,
        variants (
          id, size, color,
          products ( id, name, sku )
        )
      )
    `)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error cargando ventas:", error);
    setSalesState('empty');
    return;
  }

  allSales = data || [];
  applySalesFilters();
}

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

  const logoUrl = store.logo_url || "";
  document.getElementById("confLogo").value = logoUrl;
  // Mostrar preview del logo guardado
  const confPreview = document.getElementById("confLogoPreview");
  const confLabel = document.getElementById("confLogoLabel");
  if (confPreview) {
    if (logoUrl) {
      confPreview.innerHTML = `<img src="${logoUrl}" class="w-full h-full object-contain rounded-lg p-0.5">`;
    } else {
      confPreview.innerHTML = `<svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>`;
    }
  }
  if (confLabel) confLabel.textContent = logoUrl ? "Logo actual (subir nuevo para cambiar)" : "Seleccionar logo...";
  // Resetear file input
  const confLogoFile = document.getElementById("confLogoFile");
  if (confLogoFile) confLogoFile.value = "";
  document.getElementById("confPhone").value = store.phone || "";
  document.getElementById("confInstagram").value = store.instagram || "";
  document.getElementById("confAddress").value = store.address || "";

  loadPaymentMethods();
};

window.saveConfig = async () => {
  const btn = document.getElementById("btnSaveConfig");
  const originalText = btn.innerText;

  let logo_url = document.getElementById("confLogo").value.trim() || null;
  const phone = document.getElementById("confPhone").value.trim();
  const instagram = document.getElementById("confInstagram").value.trim();
  const address = document.getElementById("confAddress").value.trim();

  // Subir logo a Cloudinary si hay archivo nuevo
  const logoFile = document.getElementById("confLogoFile")?.files?.[0];
  if (logoFile) {
    btn.innerText = "Subiendo logo...";
    btn.disabled = true;
    try {
      const folder = `stockware/store_${storeId}/logo`;
      logo_url = await uploadToCloudinary(logoFile, folder);
      // Actualizar el hidden input y el preview
      document.getElementById("confLogo").value = logo_url;
    } catch (e) {
      btn.innerText = originalText;
      btn.disabled = false;
      showAlert('Error de imagen', 'No se pudo subir el logo. Intentá de nuevo.', 'error');
      return;
    }
  }

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

window.anularVenta = async (saleId) => {
  // Verificar estado actual antes de operar (evita doble anulación y doble reposición de stock)
  const { data: saleCheck, error: checkErr } = await supabase
    .from('sales')
    .select('status')
    .eq('id', saleId)
    .single();

  if (checkErr) { showToast('Error al verificar la venta.', 'error'); return; }
  if (saleCheck?.status === 'anulada') {
    showAlert('Venta ya anulada', 'Esta venta ya fue anulada anteriormente. El stock fue repuesto en su momento.', 'warning');
    return;
  }

  const confirmed = await showConfirm('Anular venta', '¿Confirmás la anulación? Se repondrá el stock de todos los ítems.');
  if (!confirmed) return;

  // Obtener items de la venta para reponer stock
  const { data: items, error: itemsErr } = await supabase
    .from('sale_items')
    .select('variant_id, quantity')
    .eq('sale_id', saleId);

  if (itemsErr) { showToast('Error al obtener ítems de la venta.', 'error'); return; }

  // Reponer stock variante por variante
  for (const item of items) {
    if (!item.variant_id) continue;
    const { data: variant } = await supabase
      .from('variants')
      .select('stock')
      .eq('id', item.variant_id)
      .single();
    if (variant) {
      await supabase
        .from('variants')
        .update({ stock: variant.stock + item.quantity })
        .eq('id', item.variant_id);
    }
  }

  // Marcar la venta como anulada
  const { error: voidErr } = await supabase
    .from('sales')
    .update({ status: 'anulada' })
    .eq('id', saleId);

  if (voidErr) { showToast('Error al anular la venta.', 'error'); return; }

  showToast('Venta anulada y stock repuesto.', 'success');
  loadSales();
  loadProducts();
};

// Muestra el sub-estado correcto dentro de cashView
function showCashState(state) {
  // estados posibles: 'checking' | 'opening' | 'operating'
  document.getElementById('cashCheckingState').classList.toggle('hidden', state !== 'checking');
  document.getElementById('cashOpeningState').classList.toggle('hidden', state !== 'opening');
  document.getElementById('cashOperatingState').classList.toggle('hidden', state !== 'operating');
}

async function initCashView() {
  // Actualizar label de fecha
  const labelEl = document.getElementById('cashDateLabel');
  if (labelEl) {
    const today = new Date();
    labelEl.textContent = today.toLocaleDateString('es-AR', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  showCashState('checking');

  // Verificar si existe una sesión abierta para este local
  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('store_id', storeId)
    .eq('status', 'abierta')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('initCashView error:', error);
    showToast('Error al verificar la caja.', 'error');
    showCashState('opening');
    return;
  }

  if (data) {
    // Hay sesión activa
    currentCashSession = data;
    showCashState('operating');
    renderCashSessionMeta(data);
    await loadCashSessionSales(data.id);
  } else {
    // No hay sesión abierta
    currentCashSession = null;
    showCashState('opening');
    // Limpiar input por si el cajero volvió atrás
    const input = document.getElementById('cashInitialAmount');
    if (input) input.value = '';
    loadCashSessionsHistory();
  }
}

// Muestra hora de apertura en el estado operando
function renderCashSessionMeta(session) {
  const el = document.getElementById('cashSessionOpenedAt');
  if (!el) return;
  const rawTs = session.opened_at.endsWith('Z') || session.opened_at.includes('+')
    ? session.opened_at
    : session.opened_at + 'Z';
  const date = new Date(rawTs);
  const tz = { timeZone: 'America/Argentina/Buenos_Aires' };
  el.textContent = `Apertura: ${date.toLocaleTimeString('es-AR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false })} hs`;

  // Fondo inicial
  const initialEl = document.getElementById('cash-kpi-initial');
  if (initialEl) {
    initialEl.textContent = '$' + Number(session.initial_amount).toLocaleString('es-AR', { minimumFractionDigits: 0 });
  }
}

// Abre una nueva sesión de caja
window.openCashSession = async () => {
  const input = document.getElementById('cashInitialAmount');
  const initialAmount = parseFloat(input?.value) || 0;

  const btn = document.getElementById('btnOpenCash');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Abriendo...`; }

  const { data, error } = await supabase
    .from('cash_sessions')
    .insert({ store_id: storeId, initial_amount: initialAmount, status: 'abierta' })
    .select()
    .single();

  if (btn) { btn.disabled = false; btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg> Abrir Caja`; }

  if (error) {
    console.error('openCashSession error:', error);
    showToast('Error al abrir la caja. Intentá de nuevo.', 'error');
    return;
  }

  currentCashSession = data;

  // Cerrar modal de aviso si estaba abierto
  const modal = document.getElementById('cashRequiredModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  hideCashBanner();

  showToast('Caja abierta correctamente.', 'success');
  showCashState('operating');
  renderCashSessionMeta(data);
  await loadCashSessionSales(data.id);
};

// Cierra la sesión activa (arqueo)
window.closeCashSession = async () => {
  if (!currentCashSession) return;

  const confirmed = await showConfirm('Cerrar Caja', '¿Confirmás el cierre de caja? Se registrará el arqueo del turno.');
  if (!confirmed) return;

  const btn = document.getElementById('btnCloseCash');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Cerrando...`; }

  // Calcular totales por medio de pago para el arqueo
  const { data: salesData } = await supabase
    .from('sales')
    .select('total, payment_method')
    .eq('session_id', currentCashSession.id)
    .neq('status', 'anulada');

  const allSalesData = salesData || [];

  const cashSales = allSalesData
    .filter(s => s.payment_method === 'Efectivo')
    .reduce((acc, s) => acc + Number(s.total), 0);

  const totalAllMethods = allSalesData
    .reduce((acc, s) => acc + Number(s.total), 0);

  const expectedCash = Number(currentCashSession.initial_amount) + cashSales;

  // Construir breakdown por método para guardarlo
  const byMethod = {};
  allSalesData.forEach(s => {
    const m = s.payment_method || 'Sin especificar';
    byMethod[m] = (byMethod[m] || 0) + Number(s.total);
  });

  const closedAt = new Date().toISOString();
  const sessionId = currentCashSession.id;

  // UPDATE base — siempre existe
  const { error: baseError } = await supabase
    .from('cash_sessions')
    .update({ status: 'cerrada', closed_at: closedAt })
    .eq('id', sessionId);

  if (btn) { btn.disabled = false; btn.innerHTML = `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> Cerrar Caja`; }

  if (baseError) {
    console.error('closeCashSession error:', baseError);
    showToast('Error al cerrar la caja. Intentá de nuevo.', 'error');
    return;
  }

  // UPDATE extendido — columnas opcionales, falla silenciosamente si no existen aún
  const { error: extError } = await supabase
    .from('cash_sessions')
    .update({
      actual_amount: expectedCash,
      total_amount: totalAllMethods,
      payment_breakdown: byMethod,
    })
    .eq('id', sessionId);
  if (extError) console.warn('closeCashSession campos extendidos (no crítico):', extError.message);

  // Imprimir ticket de cierre de caja
  printCashReport({
    store: currentStore,
    session: currentCashSession,
    salesData: allSalesData,
    byMethod,
    totalAllMethods,
    cashSales,
    expectedCash,
  });

  currentCashSession = null;
  showToast('Caja cerrada correctamente.', 'success');
  showCashState('opening');

  // Limpiar UI operativa
  renderCashKPIs([]);
  renderCashBreakdown([]);
  const input = document.getElementById('cashInitialAmount');
  if (input) input.value = '';

  // Refrescar historial de cierres
  loadCashSessionsHistory();
};

// ===== TICKET DE CIERRE DE CAJA =====

// Datos del último reporte generado (para imprimir desde modal)
let _lastCashReportData = null;

function printCashReport({ store, session, salesData, byMethod, totalAllMethods, cashSales, expectedCash }) {
  const tz = { timeZone: 'America/Argentina/Buenos_Aires' };
  const fmtTs = (ts) => {
    if (!ts) return '—';
    const raw = ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z';
    const d = new Date(raw);
    return d.toLocaleDateString('es-AR', { ...tz, day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('es-AR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const openedStr = fmtTs(session.opened_at);
  const closedStr = fmtTs(session.closed_at || new Date().toISOString());

  let duracion = '';
  if (session.opened_at) {
    const openRaw = session.opened_at.endsWith('Z') || session.opened_at.includes('+') ? session.opened_at : session.opened_at + 'Z';
    const closeRaw = session.closed_at
      ? (session.closed_at.endsWith('Z') || session.closed_at.includes('+') ? session.closed_at : session.closed_at + 'Z')
      : new Date().toISOString();
    const diffMs = new Date(closeRaw) - new Date(openRaw);
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    duracion = h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  const initial = Number(session.initial_amount || 0);
  const totalVentas = salesData.length;
  const ticketProm = totalVentas > 0 ? Math.round(totalAllMethods / totalVentas) : 0;

  let contactHtml = '';
  if (store?.phone) contactHtml += store.phone;
  if (store?.instagram) contactHtml += (contactHtml ? ' · ' : '') + `@${store.instagram.replace('@', '')}`;

  // Breakdown rows para el ticket visual (inline styles, sin clases)
  const breakdownRows = Object.entries(byMethod)
    .sort((a, b) => b[1] - a[1])
    .map(([method, total]) => {
      const pct = totalAllMethods > 0 ? Math.round((total / totalAllMethods) * 100) : 0;
      const count = salesData.filter(s => s.payment_method === method).length;
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:7px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:#111;">${method}</div>
          <div style="font-size:9.5px;color:#999;margin-top:1px;">${count} venta${count !== 1 ? 's' : ''} · ${pct}%</div>
        </div>
        <div style="font-size:13px;font-weight:800;color:#111;">$${Number(total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</div>
      </div>`;
    }).join('');

  const logoHtml = store?.logo_url
    ? `<div style="text-align:center;padding-top:18px;padding-bottom:6px;"><img src="${store.logo_url}" style="max-height:50px;max-width:130px;object-fit:contain;display:inline-block;"></div>`
    : '';

  const innerHtml = `
    <div style="padding:0 20px;background:#fff;">
      ${logoHtml}
      <div style="text-align:center;padding-top:${store?.logo_url ? '6px' : '18px'};padding-bottom:4px;">
        <div style="font-size:17px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#111;margin-bottom:4px;">${(store?.name || 'MI TIENDA').toUpperCase()}</div>
        ${contactHtml ? `<div style="font-size:10px;color:#666;">${contactHtml}</div>` : ''}
      </div>
      <div style="border-top:1.5px dashed #ccc;margin:12px 0;"></div>
      <div style="text-align:center;margin-bottom:12px;">
        <span style="font-size:8.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.18em;color:#aaa;">Resumen de Cierre de Caja</span>
      </div>
      <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:8px;">Datos del turno</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Apertura</span>
        <span style="font-size:10.5px;font-weight:500;color:#222;">${openedStr}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">
        <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Cierre</span>
        <span style="font-size:10.5px;font-weight:500;color:#222;">${closedStr}</span>
      </div>
      ${duracion ? `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;"><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Duración</span><span style="font-size:10.5px;font-weight:500;color:#222;">${duracion}</span></div>` : ''}
      <div style="border-top:1.5px dashed #ccc;margin:12px 0;"></div>
      <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:8px;">Resumen de ventas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px;">
        <div style="background:#f7f7f7;border-radius:6px;padding:7px 9px;">
          <div style="font-size:8.5px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;">Transacciones</div>
          <div style="font-size:13px;font-weight:800;color:#111;margin-top:1px;">${totalVentas}</div>
        </div>
        <div style="background:#f7f7f7;border-radius:6px;padding:7px 9px;">
          <div style="font-size:8.5px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;">Ticket promedio</div>
          <div style="font-size:13px;font-weight:800;color:#111;margin-top:1px;">$${ticketProm.toLocaleString('es-AR')}</div>
        </div>
      </div>
      <div style="border-top:1.5px dashed #ccc;margin:12px 0;"></div>
      <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:8px;">Por medio de pago</div>
      ${breakdownRows || '<div style="font-size:11px;color:#aaa;margin-bottom:8px;">Sin ventas registradas.</div>'}
      <div style="border-top:1.5px dashed #ccc;margin:12px 0;"></div>
      <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:8px;">Efectivo en caja</div>
      <div style="background:#f0faf4;border-radius:6px;padding:9px 11px;margin-bottom:4px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Fondo inicial</span>
          <span style="font-size:11px;font-weight:600;color:#111;">$${initial.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;">Ventas efectivo</span>
          <span style="font-size:11px;font-weight:600;color:#111;">$${cashSales.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #cce8d6;padding-top:5px;margin-top:5px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#2d7a4f;">Total en caja</span>
          <span style="font-size:14px;font-weight:800;color:#1a6640;">$${expectedCash.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
        </div>
      </div>
      <div style="border-top:1.5px dashed #ccc;margin:12px 0;"></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;">
        <span style="font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#111;">Total vendido</span>
        <span style="font-size:19px;font-weight:800;color:#111;">$${totalAllMethods.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
      </div>
      <div style="text-align:center;padding-bottom:16px;">
        <div style="font-size:10px;color:#aaa;">stockware.com.ar</div>
      </div>
    </div>
  `;

  // Poblar el área de captura del modal
  const captureArea = document.getElementById('cashReportCaptureArea');
  if (captureArea) captureArea.innerHTML = innerHtml;

  // Guardar datos para reimpresión desde modal
  _lastCashReportData = { store, session, salesData, byMethod, totalAllMethods, cashSales, expectedCash };

  // Abrir el modal
  const modal = document.getElementById('cashReportModal');
  if (modal) modal.classList.remove('hidden');
}

window.closeCashReportModal = () => {
  const modal = document.getElementById('cashReportModal');
  if (modal) modal.classList.add('hidden');
};

// Imprimir desde el modal (abre ventana de impresión con el contenido del capture area)
window.printCashReportFromModal = () => {
  const captureArea = document.getElementById('cashReportCaptureArea');
  if (!captureArea) return;
  const paperSize = localStorage.getItem('pos_paper_size') || '80mm';
  const paperW = paperSize === 'A4' ? '210mm' : paperSize;
  const win = window.open('', '', 'width=420,height=700');
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cierre de Caja</title>
    <style>
      @page { size: ${paperW} auto; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #111; background: #fff; width: ${paperW}; max-width: ${paperW}; }
      img { display: block; max-height: 50px; object-fit: contain; }
    </style></head>
    <body>${captureArea.innerHTML}</body></html>
  `);
  win.document.close();
  win.focus();
  win.onload = () => { setTimeout(() => { win.print(); win.close(); }, 500); };
  setTimeout(() => { if (!win.closed) { win.print(); win.close(); } }, 2000);
};

// Copiar imagen del cierre desde el modal
window.copyCashReportImage = async () => {
  const btn = document.getElementById('btnCopyCashReport');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `<span class="animate-pulse text-xs">Copiando...</span>`;
  btn.disabled = true;
  const captureArea = document.getElementById('cashReportCaptureArea');
  try {
    const canvas = await html2canvas(captureArea, { scale: 3, backgroundColor: '#FFFFFF', useCORS: true, allowTaint: true, logging: false });
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('¡Imagen copiada!', 'success');
      } catch (err) {
        showToast('Tu navegador no permite copiar imágenes. Usá descargar.', 'warning');
      } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
      }
    }, 'image/png');
  } catch (e) {
    showToast('Error al generar la imagen', 'error');
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
};

// Descargar imagen del cierre desde el modal
window.downloadCashReportImage = async () => {
  const btn = document.getElementById('btnDownloadCashReport');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `<span class="animate-pulse text-xs">Generando...</span>`;
  btn.disabled = true;
  const captureArea = document.getElementById('cashReportCaptureArea');
  try {
    const canvas = await html2canvas(captureArea, { scale: 3, backgroundColor: '#FFFFFF', useCORS: true, allowTaint: true, logging: false });
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `CierreCaja_${Date.now()}.png`;
    a.click();
  } catch (e) {
    showToast('Error al generar la imagen', 'error');
  } finally {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }
};


// Carga las ventas vinculadas a la sesión activa (solo métricas, sin lista)
async function loadCashSessionSales(sessionId) {
  const { data, error } = await supabase
    .from('sales')
    .select(`*, sale_items(id, quantity, price)`)
    .eq('session_id', sessionId)
    .neq('status', 'anulada')
    .order('created_at', { ascending: false });

  if (error) { console.error('loadCashSessionSales error:', error); showToast('Error cargando ventas.', 'error'); return; }

  const sales = data || [];

  renderCashKPIs(sales);
  renderCashBreakdown(sales);

  // Efectivo esperado = fondo inicial + ventas en efectivo del turno
  const cashSales = sales
    .filter(s => s.payment_method === 'Efectivo')
    .reduce((acc, s) => acc + Number(s.total), 0);
  const expectedCash = Number(currentCashSession?.initial_amount || 0) + cashSales;
  const expectedEl = document.getElementById('cash-kpi-cash-expected');
  if (expectedEl) expectedEl.textContent = '$' + expectedCash.toLocaleString('es-AR', { minimumFractionDigits: 0 });
}

// Carga y renderiza el historial de cierres de caja
async function loadCashSessionsHistory() {
  const loadingEl = document.getElementById('cashHistoryLoading');
  const emptyEl   = document.getElementById('cashHistoryEmpty');
  const wrapperEl = document.getElementById('cashHistoryTableWrapper');
  const headerEl  = document.getElementById('cashHistoryTableHeader');
  const listEl    = document.getElementById('cashHistoryList');
  const countEl   = document.getElementById('cashHistoryCount');

  const setCashHistoryState = (state) => {
    [loadingEl, emptyEl, wrapperEl].forEach(el => { if (el) el.classList.add('hidden'); });
    if (state === 'loading' && loadingEl) loadingEl.classList.remove('hidden');
    else if (state === 'empty' && emptyEl)  emptyEl.classList.remove('hidden');
    else if (state === 'data' && wrapperEl) {
      wrapperEl.classList.remove('hidden');
      if (headerEl) headerEl.classList.remove('hidden');
    }
  };

  setCashHistoryState('loading');
  if (listEl) listEl.innerHTML = '';

  const { data, error } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('store_id', storeId)
    .eq('status', 'cerrada')
    .order('closed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('loadCashSessionsHistory error:', error);
    showToast('Error al cargar el historial.', 'error');
    setCashHistoryState('empty');
    return;
  }

  const sessions = data || [];

  if (countEl) countEl.textContent = sessions.length > 0 ? `${sessions.length} registro${sessions.length !== 1 ? 's' : ''}` : '';

  if (sessions.length === 0) {
    setCashHistoryState('empty');
    return;
  }

  // Para sesiones sin total_amount, cargar ventas desde la BD
  const sessionIds = sessions
    .filter(s => s.total_amount == null)
    .map(s => s.id);

  let salesBySession = {};
  if (sessionIds.length > 0) {
    const { data: oldSales } = await supabase
      .from('sales')
      .select('session_id, total, payment_method')
      .in('session_id', sessionIds)
      .neq('status', 'anulada');

    (oldSales || []).forEach(s => {
      if (!salesBySession[s.session_id]) salesBySession[s.session_id] = [];
      salesBySession[s.session_id].push(s);
    });
  }

  setCashHistoryState('data');

  const tz = { timeZone: 'America/Argentina/Buenos_Aires' };
  const paymentBadgeColors = {
    'Efectivo':          'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    'Transferencia':     'text-blue-400 bg-blue-500/10 border-blue-500/20',
    'Tarjeta de Débito': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'Tarjeta de Crédito':'text-violet-400 bg-violet-500/10 border-violet-500/20',
  };

  sessions.forEach(session => {
    const fmtTs = (ts) => {
      if (!ts) return '—';
      const raw = ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z';
      const d = new Date(raw);
      return d.toLocaleDateString('es-AR', { ...tz, day: '2-digit', month: '2-digit' })
        + ' ' + d.toLocaleTimeString('es-AR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const openedStr = fmtTs(session.opened_at);
    const closedStr = fmtTs(session.closed_at);
    const initial   = Number(session.initial_amount || 0);
    const cashFinal = Number(session.actual_amount || 0); // efectivo en caja

    // Total vendido (todos los medios)
    let totalSold = 0;
    let breakdown = session.payment_breakdown || null;

    if (session.total_amount != null) {
      totalSold = Number(session.total_amount);
    } else {
      // Calcular desde ventas cargadas
      const relSales = salesBySession[session.id] || [];
      totalSold = relSales.reduce((a, s) => a + Number(s.total), 0);
      // Construir breakdown si no estaba guardado
      if (!breakdown && relSales.length > 0) {
        breakdown = {};
        relSales.forEach(s => {
          const m = s.payment_method || 'Sin especificar';
          breakdown[m] = (breakdown[m] || 0) + Number(s.total);
        });
      }
    }

    // Duración
    let duracion = '';
    if (session.opened_at && session.closed_at) {
      const openRaw  = session.opened_at.endsWith('Z') || session.opened_at.includes('+') ? session.opened_at : session.opened_at + 'Z';
      const closeRaw = session.closed_at.endsWith('Z') || session.closed_at.includes('+') ? session.closed_at : session.closed_at + 'Z';
      const diffMs   = new Date(closeRaw) - new Date(openRaw);
      const diffHrs  = Math.floor(diffMs / 3600000);
      const diffMins = Math.floor((diffMs % 3600000) / 60000);
      duracion = diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`;
    }

    // Breakdown HTML (para expandir)
    const breakdownHtml = breakdown && Object.keys(breakdown).length > 0
      ? Object.entries(breakdown)
          .sort((a, b) => b[1] - a[1])
          .map(([m, total]) => {
            const cls = paymentBadgeColors[m] || 'text-slate-300 bg-slate-500/10 border-slate-500/20';
            return `<div class="flex items-center justify-between py-1">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}">${m}</span>
              <span class="text-xs font-bold text-white">$${Number(total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
            </div>`;
          }).join('')
      : `<p class="text-xs text-slate-600 py-1">Sin desglose disponible.</p>`;

    const detailId = `cash-hist-${session.id}`;

    const row = document.createElement('div');
    row.className = 'border-b border-slate-800/50 last:border-0';
    row.innerHTML = `
      <!-- Fila principal (clickeable) -->
      <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-800/30 transition-colors cursor-pointer group" onclick="toggleCashHistDetail('${session.id}')">
        <div class="col-span-4 md:col-span-3">
          <p class="text-xs font-semibold text-white">${openedStr}</p>
          <p class="text-[10px] text-slate-500 mt-0.5">${closedStr}${duracion ? ' · ' + duracion : ''}</p>
        </div>
        <div class="col-span-3 hidden md:block">
          <p class="text-xs text-slate-400">Fondo inicial</p>
          <p class="text-xs font-semibold text-slate-300">$${initial.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
        </div>
        <div class="col-span-3 hidden md:block">
          <p class="text-xs text-slate-400">Efectivo en caja</p>
          <p class="text-xs font-semibold text-emerald-400">$${cashFinal.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
        </div>
        <div class="col-span-6 md:col-span-3 flex items-center justify-end gap-2">
          <div class="text-right">
            <p class="text-[10px] text-slate-500">Total vendido</p>
            <p class="text-sm font-black text-indigo-400">$${totalSold.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
          </div>
          <svg id="chev-hist-${session.id}" class="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-all flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <!-- Detalle expandible -->
      <div id="${detailId}" class="hidden px-4 pb-4 pt-1 bg-slate-800/20">
        <div class="bg-slate-900/80 rounded-xl p-3 border border-slate-800">
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Desglose por medio de pago</p>
          <div class="divide-y divide-slate-800/50">${breakdownHtml}</div>
          <div class="mt-3 pt-2.5 border-t border-slate-700 grid grid-cols-3 gap-2 text-center md:hidden">
            <div>
              <p class="text-[10px] text-slate-500">Fondo</p>
              <p class="text-xs font-bold text-slate-300">$${initial.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-500">Efectivo</p>
              <p class="text-xs font-bold text-emerald-400">$${cashFinal.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-500">Total</p>
              <p class="text-xs font-bold text-indigo-400">$${totalSold.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</p>
            </div>
          </div>
          <!-- Botón reimprimir -->
          <button onclick="reprintCashReport('${session.id}')" class="mt-3 w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold py-2 rounded-lg transition-all active:scale-95">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
            Imprimir resumen
          </button>
        </div>
      </div>
    `;
    listEl.appendChild(row);
  });
}

window.toggleCashHistDetail = (id) => {
  const detail = document.getElementById(`cash-hist-${id}`);
  const chev   = document.getElementById(`chev-hist-${id}`);
  if (!detail) return;
  const hidden = detail.classList.toggle('hidden');
  if (chev) chev.style.transform = hidden ? '' : 'rotate(180deg)';
};

// Reimprimir resumen de cierre desde el historial
window.reprintCashReport = async (sessionId) => {
  const { data: session, error: sessErr } = await supabase
    .from('cash_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (sessErr || !session) { showToast('No se pudo cargar la sesión.', 'error'); return; }

  const { data: salesData } = await supabase
    .from('sales')
    .select('total, payment_method')
    .eq('session_id', sessionId)
    .neq('status', 'anulada');

  const allSalesData = salesData || [];

  let byMethod = session.payment_breakdown || {};
  if (!session.payment_breakdown || Object.keys(byMethod).length === 0) {
    byMethod = {};
    allSalesData.forEach(s => {
      const m = s.payment_method || 'Sin especificar';
      byMethod[m] = (byMethod[m] || 0) + Number(s.total);
    });
  }

  const cashSales = allSalesData
    .filter(s => s.payment_method === 'Efectivo')
    .reduce((acc, s) => acc + Number(s.total), 0);

  const totalAllMethods = session.total_amount != null
    ? Number(session.total_amount)
    : allSalesData.reduce((acc, s) => acc + Number(s.total), 0);

  const expectedCash = Number(session.initial_amount || 0) + cashSales;

  printCashReport({
    store: currentStore,
    session,
    salesData: allSalesData,
    byMethod,
    totalAllMethods,
    cashSales,
    expectedCash,
  });
};

function renderCashKPIs(sales) {
  const total = sales.reduce((a, s) => a + Number(s.total), 0);
  const units = sales.reduce((a, s) => a + (s.sale_items || []).reduce((b, i) => b + (i.quantity || 0), 0), 0);
  const avg = sales.length > 0 ? total / sales.length : 0;
  document.getElementById('cash-kpi-count').textContent = sales.length;
  document.getElementById('cash-kpi-total').textContent = '$' + total.toLocaleString('es-AR', { minimumFractionDigits: 0 });
  document.getElementById('cash-kpi-avg').textContent = '$' + Math.round(avg).toLocaleString('es-AR');
  document.getElementById('cash-kpi-units').textContent = units;
}

function renderCashBreakdown(sales) {
  const container = document.getElementById('cashPaymentBreakdown');
  if (!container) return;
  if (sales.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-600">Sin ventas en este turno.</p>';
    return;
  }
  const byMethod = {};
  sales.forEach(s => {
    const m = s.payment_method || 'Sin especificar';
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count++;
    byMethod[m].total += Number(s.total);
  });
  const grandTotal = sales.reduce((a, s) => a + Number(s.total), 0);
  const paymentColors = {
    'Efectivo':          { bar: 'bg-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    'Transferencia':     { bar: 'bg-blue-500',    badge: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    'Tarjeta de Débito': { bar: 'bg-amber-500',   badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    'Tarjeta de Crédito':{ bar: 'bg-violet-500',  badge: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  };
  container.innerHTML = Object.entries(byMethod)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([method, data]) => {
      const pct = grandTotal > 0 ? Math.round((data.total / grandTotal) * 100) : 0;
      const cfg = paymentColors[method] || { bar: 'bg-slate-500', badge: 'text-slate-300 bg-slate-500/10 border-slate-500/20' };
      return `
        <div class="bg-slate-800/40 rounded-xl p-3 border border-slate-700/50">
          <div class="flex justify-between items-center mb-2">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.badge}">${method}</span>
              <span class="text-[10px] text-slate-500">${data.count} venta${data.count !== 1 ? 's' : ''}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] text-slate-500">${pct}%</span>
              <span class="text-sm font-black text-white">$${data.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</span>
            </div>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5">
            <div class="${cfg.bar} h-1.5 rounded-full transition-all duration-500" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');
}


const DEFAULT_PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta de Débito', 'Tarjeta de Crédito', 'Otros'];

async function loadPaymentMethods() {
  const list = document.getElementById('paymentMethodsList');
  if (!list) return;

  let methods = [];

  // Intentar leer de store_payment_methods
  const { data, error } = await supabase
    .from('store_payment_methods')
    .select('id, name')
    .eq('store_id', storeId)
    .order('position', { ascending: true });

  if (!error && data && data.length > 0) {
    methods = data.map(r => r.name);
  } else {
    // Fallback: campo payment_methods jsonb en stores
    const { data: storeData } = await supabase
      .from('stores')
      .select('payment_methods')
      .eq('id', storeId)
      .single();
    methods = storeData?.payment_methods || DEFAULT_PAYMENT_METHODS;
  }

  renderPaymentMethodRows(methods);
  updatePaymentSelects(methods);
}

function renderPaymentMethodRows(methods) {
  const list = document.getElementById('paymentMethodsList');
  list.innerHTML = '';
  methods.forEach(m => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 pm-row';
    div.innerHTML = `
      <input type="text" value="${m}" class="pm-input flex-1 p-2.5 bg-slate-800 border border-slate-700 text-white text-sm rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-600">
      <button onclick="removePaymentMethodRow(this)" class="w-8 h-8 flex-shrink-0 flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500/20 rounded-lg border border-transparent hover:border-red-500/30 transition-all">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    `;
    list.appendChild(div);
  });
}
window.addPaymentMethodRow = () => {
  const list = document.getElementById('paymentMethodsList');
  const div = document.createElement('div');
  div.className = 'flex items-center gap-2 pm-row';
  div.innerHTML = `
    <input type="text" placeholder="Ej: Mercado Pago" class="pm-input flex-1 p-2.5 bg-slate-800 border border-slate-700 text-white text-sm rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none transition placeholder-slate-600">
    <button onclick="removePaymentMethodRow(this)" class="w-8 h-8 flex-shrink-0 flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500/20 rounded-lg border border-transparent hover:border-red-500/30 transition-all">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  `;
  list.appendChild(div);
  div.querySelector('.pm-input').focus();
};
window.removePaymentMethodRow = (btn) => {
  btn.closest('.pm-row').remove();
  const currentMethods = [...document.querySelectorAll('.pm-input')]
    .map(i => i.value.trim())
    .filter(Boolean);
  updatePaymentSelects(currentMethods);
  
  // Guardado automático al eliminar
  savePaymentMethods();
};

window.savePaymentMethods = async () => {
  const methods = [...document.querySelectorAll('.pm-input')]
    .map(i => i.value.trim())
    .filter(Boolean);

  if (methods.length === 0) {
    showAlert('Error', 'Necesitás al menos un método de pago habilitado.', 'error');
    return;
  }
  const btn = document.querySelector('[onclick="savePaymentMethods()"]');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Guardando...'; btn.disabled = true; }

  // Intentar guardar en store_payment_methods
  // 1. Eliminar los anteriores
  const { error: delErr } = await supabase
    .from('store_payment_methods')
    .delete()
    .eq('store_id', storeId);

  let savedToTable = !delErr;

  if (savedToTable) {
    // 2. Insertar los nuevos
    const rows = methods.map((name, i) => ({ store_id: storeId, name, position: i }));
    const { error: insErr } = await supabase.from('store_payment_methods').insert(rows);
    if (insErr) savedToTable = false;
  }

  if (!savedToTable) {
    // Fallback: guardar en stores.payment_methods jsonb
    const { error: updateErr } = await supabase
      .from('stores')
      .update({ payment_methods: methods })
      .eq('id', storeId);
    if (updateErr) {
      if (btn) { btn.textContent = origText; btn.disabled = false; }
      showToast('Error al guardar métodos de pago.', 'error');
      return;
    }
  }

  if (btn) { btn.textContent = origText; btn.disabled = false; }

  // Actualizar selectores de pago en el DOM
  updatePaymentSelects(methods);
  showToast('Métodos de pago guardados.', 'success');
};

function updatePaymentSelects(methods) {
  const selects = ['paymentMethod', 'paymentMethodMobile', 'salesPaymentFilter'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const currentVal = sel.value;
    const isFilter = id === 'salesPaymentFilter';
    sel.innerHTML = isFilter ? '<option value="">Todos los medios</option>' : '';
    methods.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    });
    // Restaurar selección si sigue disponible
    if ([...sel.options].some(o => o.value === currentVal)) sel.value = currentVal;
  });
}

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
  // Cambio realizado: z-[100] elevado a z-[10000] para evitar que quede oculto por el overlay (z-[9999])
  toast.className = `fixed bottom-6 right-6 z-[10000] flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-sm font-semibold ${colors[type]}`;
  toast.style.cssText = 'opacity:0;transform:translateY(8px);transition:opacity 0.25s,transform 0.25s';
  toast.innerHTML = `${icons[type]}<span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateY(0)'; });
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateY(8px)'; setTimeout(() => toast.remove(), 300); }, 3200);
}
// ==========================================
window._posModuleCopyText = (text) => {
  navigator.clipboard.writeText(text);
  showToast("Copiado al portapapeles", "success");
};

window._posModuleCopyPaymentInfo = () => {
  const info = `DATOS DE PAGO STOCKWARE\n\nAlias: STOCKWARE.POS\nCBU: 0000003100076543210001\nMonto: $15.000\n\nEnviar comprobante a WhatsApp: +54 9 3644 539325`;
  navigator.clipboard.writeText(info);
  showToast("Datos de pago copiados", "success");
};

window._posModuleGeneratePaymentLink = window.generatePaymentLink;
// Start
initPos();
document.dispatchEvent(new Event('pos-module-ready'));
