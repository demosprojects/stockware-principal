import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://fxqomvjynncaigwoasqp.supabase.co";
const supabaseKey = "sb_publishable_Mwq88wTGFEHF9zvvM7xWmw_9FQmjlZO";

const supabase = createClient(supabaseUrl, supabaseKey);

const authSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const ADMIN_EMAIL = "admin@stockware.com";
let allStores = []; 
window.currentManageId = null; 

// ==========================================
// SISTEMA DE MODALES (Reemplazo de Alerts)
// ==========================================

window.showAlert = (message, title = "Notificación del Sistema") => {
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('customAlertModal').classList.remove('hidden');
};

window.closeAlertModal = () => {
    document.getElementById('customAlertModal').classList.add('hidden');
};

window.showConfirm = (message, title = "Requiere Confirmación", isDestructive = false) => {
    return new Promise((resolve) => {
        document.getElementById('confirmTitle').innerText = title;
        document.getElementById('confirmMessage').innerText = message;
        document.getElementById('customConfirmModal').classList.remove('hidden');

        const btnConfirm = document.getElementById('btnConfirmAction');
        const btnCancel = document.getElementById('btnCancelAction');

        if (isDestructive) {
            btnConfirm.className = "w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-red-600/90 hover:bg-red-500 text-white rounded-xl text-sm font-medium transition shadow-[0_0_15px_rgba(220,38,38,0.2)] active:scale-95";
        } else {
            btnConfirm.className = "w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition shadow-[0_0_15px_rgba(79,70,229,0.2)] active:scale-95";
        }

        btnConfirm.onclick = () => {
            document.getElementById('customConfirmModal').classList.add('hidden');
            resolve(true);
        };

        btnCancel.onclick = () => {
            document.getElementById('customConfirmModal').classList.add('hidden');
            resolve(false);
        };
    });
};

// Verificar acceso
async function checkAdmin() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user || user.email !== ADMIN_EMAIL) {
    document.body.innerHTML = `
      <div class="flex h-screen items-center justify-center bg-[#0B1120] p-4">
        <div class="text-center p-6 sm:p-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-sm">
          <svg class="w-12 h-12 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          <h1 class="text-xl sm:text-2xl font-bold text-white mb-2">Acceso Restringido</h1>
          <p class="text-slate-400 text-sm mb-6">Se requiere nivel de autorización de administrador.</p>
          <a href="index.html" class="inline-flex items-center justify-center w-full sm:w-auto gap-2 bg-slate-800 text-white py-3 px-5 rounded-xl hover:bg-slate-700 text-sm transition font-medium active:scale-95">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Retornar al portal
          </a>
        </div>
      </div>`;
    return null;
  }
  return user;
}

// Cargar tiendas base de datos
async function loadStores() {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    showAlert("Error de conexión al cargar las instancias.", "Fallo de Sistema");
    return;
  }

  allStores = data || [];
  updateMetrics();
  renderStores(allStores);
}

// Actualizar Métricas Superiores
function updateMetrics() {
    const total = allStores.length;
    let active = 0;
    
    allStores.forEach(store => {
        const isExpired = store.expires_at && new Date(store.expires_at) < new Date();
        if (store.active && !isExpired) active++;
    });

    document.getElementById('statTotal').innerText = total;
    document.getElementById('statActive').innerText = active;
    document.getElementById('statInactive').innerText = total - active;
}

// Renderizar grilla
function renderStores(storesToRender) {
  const grid = document.getElementById("storesGrid");
  grid.innerHTML = "";

  if (storesToRender.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-16 px-4 text-center flex flex-col items-center justify-center bg-slate-900/30 border border-slate-800/50 rounded-2xl">
        <svg class="w-12 h-12 text-slate-700 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
        <p class="text-slate-500 text-sm">No se encontraron instancias en la base de datos.</p>
    </div>`;
    return;
  }

  storesToRender.forEach(store => {
    const isExpired = store.expires_at && new Date(store.expires_at) < new Date();
    const isActive = store.active && !isExpired;

    const statusColor = isActive
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : "text-red-400 bg-red-500/10 border-red-500/20";

    const statusText = isActive ? "OPERATIVA" : (store.active && isExpired ? "LIC. VENCIDA" : "SUSPENDIDA");
    const formattedDate = store.expires_at ? new Date(store.expires_at).toLocaleDateString('es-AR') : 'Indefinido';

    const card = document.createElement("div");
    card.className = "bg-slate-900/50 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col hover:border-slate-700 hover:bg-slate-900 transition-all shadow-lg relative group overflow-hidden";
    
    // Indicador lateral de estado
    const sideIndicatorColor = isActive ? "bg-emerald-500" : "bg-red-500";
    
    card.innerHTML = `
      <div class="absolute left-0 top-0 bottom-0 w-1 ${sideIndicatorColor} opacity-50 group-hover:opacity-100 transition-opacity"></div>
      
      <div class="flex justify-between items-start mb-3 pl-2 sm:pl-2">
          <div class="overflow-hidden">
            <h3 class="text-base sm:text-[17px] font-bold text-slate-100 truncate pr-2 tracking-tight">${store.name}</h3>
            <p class="text-[11px] font-mono text-slate-500 truncate mt-0.5">${store.email || 'Sin correo'}</p>
          </div>
          <span class="inline-flex items-center px-2 py-1 rounded text-[9px] font-bold border tracking-wider ${statusColor} shrink-0 mt-0.5">
            ${statusText}
          </span>
      </div>

      <div class="bg-[#0B1120] rounded-lg p-3 sm:p-3.5 border border-slate-800 mb-5 ml-2">
          <div class="flex justify-between items-center mb-2.5">
            <p class="text-[10px] text-slate-500 uppercase font-semibold">Vencimiento</p>
            <p class="text-[13px] sm:text-xs text-slate-300 font-mono">${formattedDate}</p>
          </div>
          <div class="flex justify-between items-center">
            <p class="text-[10px] text-slate-500 uppercase font-semibold">ID Red</p>
            <p class="text-[11px] text-slate-600 font-mono truncate w-24 text-right" title="${store.id}">${store.id.split('-')[0]}...</p>
          </div>
      </div>

      <!-- Paddings aumentados (py-2.5 y py-3) para mejor experiencia táctil -->
      <div class="mt-auto grid grid-cols-2 gap-2 sm:gap-2.5 ml-2">
          <button onclick="openManageModal('${store.id}')" class="w-full bg-slate-800/50 hover:bg-slate-700 text-slate-300 text-[11px] sm:text-xs font-medium py-2.5 sm:py-2 rounded-lg border border-slate-700 transition-colors flex justify-center items-center gap-1.5 active:scale-95">
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
              Ajustes
          </button>
          <button onclick="addTime('${store.id}')" class="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-[11px] sm:text-xs font-medium py-2.5 sm:py-2 rounded-lg border border-indigo-500/20 transition-colors flex justify-center items-center gap-1.5 active:scale-95">
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              +30 Días
          </button>
          <button onclick="toggleStore('${store.id}', ${store.active})" class="w-full ${store.active ? 'bg-slate-800/50 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border-slate-700 hover:border-red-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'} text-[11px] sm:text-xs font-medium py-2.5 sm:py-2 rounded-lg border transition-colors flex justify-center items-center gap-1.5 active:scale-95">
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${store.active ? 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' : 'M5 13l4 4L19 7'}"></path></svg>
              ${store.active ? "Suspender" : "Reactivar"}
          </button>
          <button onclick="deleteStore('${store.id}')" class="w-full bg-slate-800/50 hover:bg-red-500/10 text-slate-500 hover:text-red-400 text-[11px] sm:text-xs font-medium py-2.5 sm:py-2 rounded-lg border border-slate-700 hover:border-red-500/30 transition-colors flex justify-center items-center gap-1.5 active:scale-95">
              <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              Destruir
          </button>
          <button onclick="impersonateStore('${store.email}', '${store.password_text}', '${store.name}')" class="w-full col-span-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-xs font-medium py-3 sm:py-2.5 rounded-lg border border-indigo-500 transition-colors flex justify-center items-center gap-2 mt-1 sm:mt-1.5 shadow-sm active:scale-95">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
              Acceder como Cliente
          </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Búsqueda en tiempo real
document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allStores.filter(s => 
        (s.name && s.name.toLowerCase().includes(term)) || 
        (s.email && s.email.toLowerCase().includes(term))
    );
    renderStores(filtered);
});

// Activar / Desactivar
window.toggleStore = async (storeId, currentState) => {
  const { error } = await supabase
    .from("stores")
    .update({ active: !currentState })
    .eq("id", storeId);

  if (error) return showAlert("Error al modificar el estado de la instancia.", "Fallo de Sistema");
  loadStores();
};

// Agregar 30 días
window.addTime = async (id) => {
  const { data: store } = await supabase
    .from("stores")
    .select("expires_at")
    .eq("id", id)
    .single();

  const base = store?.expires_at && new Date(store.expires_at) > new Date()
    ? new Date(store.expires_at)
    : new Date();

  base.setDate(base.getDate() + 30);

  const { error } = await supabase
    .from("stores")
    .update({ expires_at: base.toISOString(), active: true })
    .eq("id", id);

  if (error) return showAlert("Error al extender la licencia temporal.", "Fallo de Sistema");
  loadStores();
};

// Eliminar Tienda
window.deleteStore = async (id) => {
    const confirmed = await showConfirm("ADVERTENCIA: ¿Proceder con la eliminación de esta instancia? Esta acción es irreversible y purgará todo su catálogo y registros de venta.", "Destrucción de Instancia", true);
    if(!confirmed) return;

    const { error } = await supabase.from('stores').delete().eq('id', id);
    if(error) return showAlert("Fallo al purgar la instancia: " + error.message, "Fallo de Sistema");

    loadStores();
}

// IMPERSONATE: Entrar como el cliente
window.impersonateStore = async (email, password, storeName) => {
    if (!email || !password) return showAlert("Fallo de autenticación: Credenciales no registradas en la base de datos visual.", "Error de Autenticación");
    
    const confirmed = await showConfirm(`¿Establecer conexión remota como [${storeName}]? Esto cerrará tu sesión de administrador local.`, "Conexión Remota", false);
    if (!confirmed) return;

    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        showAlert("Fallo en el protocolo de acceso: " + error.message, "Fallo de Sistema");
    } else {
        window.location.href = "index.html";
    }
};

// Cerrar sesión
window.logout = async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
};

// ==========================================
// MODALES Y GESTIÓN
// ==========================================
window.openNewStoreModal = () => {
    document.getElementById("newStoreName").value = "";
    document.getElementById("newStoreEmail").value = "";
    document.getElementById("newStorePassword").value = "";
    document.getElementById("newStoreModal").classList.remove("hidden");
};

window.closeModal = () => {
    document.getElementById("newStoreModal").classList.add("hidden");
};

// ABRIR MODAL DE EDICIÓN
window.openManageModal = (id) => {
    const store = allStores.find(s => s.id === id);
    if(!store) return;
    
    window.currentManageId = id;
    document.getElementById('manageStoreName').value = store.name;
    document.getElementById('manageStoreEmail').value = store.email || '';
    document.getElementById('manageStorePassword').value = store.password_text || '';
    document.getElementById('manageStorePassword').type = 'password';
    
    if(store.expires_at) {
        const d = new Date(store.expires_at);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        document.getElementById('manageStoreDate').value = `${year}-${month}-${day}`;
    } else {
        document.getElementById('manageStoreDate').value = "";
    }
    
    document.getElementById('manageStoreModal').classList.remove('hidden');
}

window.closeManageModal = () => {
    document.getElementById('manageStoreModal').classList.add('hidden');
}

window.togglePasswordVisibility = () => {
    const input = document.getElementById('manageStorePassword');
    input.type = input.type === 'password' ? 'text' : 'password';
}

// GUARDAR CAMBIOS DE EDICIÓN
window.saveStoreChanges = async () => {
    const id = window.currentManageId;
    const name = document.getElementById('manageStoreName').value.trim();
    const email = document.getElementById('manageStoreEmail').value.trim();
    const password_text = document.getElementById('manageStorePassword').value;
    const dateVal = document.getElementById('manageStoreDate').value;

    if (!name) return showAlert("Requisito de sistema: El nombre no puede estar vacío.", "Error de Validación");

    let expires_at = null;
    if (dateVal) {
        expires_at = new Date(`${dateVal}T12:00:00Z`).toISOString();
    }

    const btn = document.getElementById("btnSaveManage");
    const originalText = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Procesando...`;
    btn.disabled = true;

    const { error } = await supabase
        .from("stores")
        .update({ name, email, password_text, expires_at })
        .eq("id", id);

    btn.innerHTML = originalText;
    btn.disabled = false;

    if (error) return showAlert("Error de escritura en base de datos: " + error.message, "Fallo de Sistema");

    closeManageModal();
    loadStores();
};

// Crear tienda
window.createStore = async () => {
    const name = document.getElementById("newStoreName").value.trim();
    const email = document.getElementById("newStoreEmail").value.trim();
    const password = document.getElementById("newStorePassword").value;
    const btn = document.getElementById("btnCreate");

    if (!name || !email || password.length < 6) {
        showAlert("Parámetros incompletos. La clave requiere un mínimo de 6 caracteres de seguridad.", "Error de Validación");
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Ejecutando...`;
    btn.disabled = true;

    const { data: authData, error: authError } = await authSupabase.auth.signUp({
        email,
        password
    });

    if (authError) {
        showAlert("Error de autenticación: " + authError.message, "Fallo de Sistema");
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    if (!authData.user || authData.user.identities?.length === 0) {
        showAlert("Conflicto: Este correo ya existe en el registro de Auth.", "Conflicto de Datos");
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    const owner_id = authData.user.id;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { error: dbError } = await supabase
        .from("stores")
        .insert({
            name,
            owner_id,
            active: true,
            expires_at: expiresAt.toISOString(),
            email: email, 
            password_text: password
        });

    btn.innerHTML = originalText;
    btn.disabled = false;

    if (dbError) {
        console.error(dbError);
        showAlert("Advertencia: Cuenta creada en Auth, pero falló la escritura en 'stores': " + dbError.message, "Inconsistencia de Datos");
        return;
    }

    closeModal();
    loadStores();
};

// Arranque
(async () => {
  const user = await checkAdmin();
  if (!user) return;
  loadStores();
})();
