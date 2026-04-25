import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://fxqomvjynncaigwoasqp.supabase.co";
const supabaseKey = "sb_publishable_Mwq88wTGFEHF9zvvM7xWmw_9FQmjlZO";

const supabase = createClient(supabaseUrl, supabaseKey);

const authSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const ADMIN_EMAIL = "admin@stockware.com";
let allStores = []; // Para guardar los datos globales y usarlos en el modal
window.currentManageId = null; // Para saber qué tienda estamos editando

// 🔐 Verificar acceso
async function checkAdmin() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user || user.email !== ADMIN_EMAIL) {
    document.body.innerHTML = `
      <div class="flex h-screen items-center justify-center bg-[#0B1120]">
        <div class="text-center">
          <h1 class="text-3xl font-bold text-red-500 mb-2">Acceso Denegado</h1>
          <p class="text-slate-400">Solo el administrador puede ver este panel.</p>
          <a href="index.html" class="mt-4 inline-block text-indigo-400 hover:text-indigo-300 text-sm transition">Volver al login</a>
        </div>
      </div>`;
    return null;
  }
  return user;
}

// 📦 Cargar tiendas (CON MÉTRICAS Y LOGIN MÁGICO)
async function loadStores() {
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    alert("Error cargando tiendas");
    return;
  }

  allStores = data || [];
  const grid = document.getElementById("storesGrid");
  grid.innerHTML = "";

  if (allStores.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-20 text-center text-slate-500">No hay tiendas registradas aún.</div>`;
    return;
  }

  allStores.forEach(store => {
    const isExpired = store.expires_at && new Date(store.expires_at) < new Date();

    const statusColor = store.active && !isExpired
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : "text-red-400 bg-red-500/10 border-red-500/20";

    const statusText = store.active && !isExpired
      ? "Activa"
      : (store.active && isExpired ? "Vencida" : "Bloqueada");

    const card = document.createElement("div");
    card.className = "bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col hover:border-slate-700 transition-all shadow-xl";
    card.innerHTML = `
      <div class="flex justify-between items-start mb-2">
          <h3 class="text-lg font-bold text-white truncate pr-2">${store.name}</h3>
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${statusColor} shrink-0">
            ${statusText}
          </span>
      </div>
      <p class="text-xs text-slate-500 mb-4">Vence: <span class="text-slate-300 font-medium">${store.expires_at ? new Date(store.expires_at).toLocaleDateString('es-AR') : 'Sin fecha'}</span></p>

      <div class="mb-5 grid grid-cols-2 gap-2">
          <div class="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/50">
              <p class="text-[10px] text-slate-500 uppercase font-semibold mb-0.5">Última Conexión</p>
              <p class="text-xs text-slate-300 font-medium">Reciente</p>
          </div>
          <div class="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700/50">
              <p class="text-[10px] text-slate-500 uppercase font-semibold mb-0.5">Uso de sistema</p>
              <p class="text-xs text-emerald-400 font-medium">Activo</p>
          </div>
      </div>

      <div class="mt-auto grid grid-cols-2 gap-2">
          <button onclick="openManageModal('${store.id}')" class="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium py-2 rounded-lg border border-slate-700 transition-colors">
              Gestionar
          </button>
          <button onclick="addTime('${store.id}')" class="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-xs font-medium py-2 rounded-lg border border-indigo-500/20 transition-colors">
              +30 Días
          </button>
          <button onclick="toggleStore('${store.id}', ${store.active})" class="w-full ${store.active ? 'bg-slate-800 hover:bg-red-500/10 text-slate-400 hover:text-red-400 border-slate-700 hover:border-red-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20'} text-xs font-medium py-2 rounded-lg border transition-colors">
              ${store.active ? "Bloquear" : "Activar"}
          </button>
          <button onclick="deleteStore('${store.id}')" class="w-full bg-slate-800 hover:bg-red-500/10 text-slate-500 hover:text-red-400 text-xs font-medium py-2 rounded-lg border border-slate-700 hover:border-red-500/30 transition-colors">
              Eliminar
          </button>
          <button onclick="impersonateStore('${store.email}', '${store.password_text}', '${store.name}')" class="w-full col-span-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium py-2 rounded-lg border border-indigo-500 transition-colors flex justify-center items-center gap-2 mt-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path></svg>
              Entrar como cliente
          </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

// 🔄 Activar / Desactivar
window.toggleStore = async (storeId, currentState) => {
  const { error } = await supabase
    .from("stores")
    .update({ active: !currentState })
    .eq("id", storeId);

  if (error) return alert("Error actualizando estado.");
  loadStores();
};

// ⏱️ Agregar 30 días
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

  if (error) return alert("Error agregando tiempo.");
  loadStores();
};

// 🗑️ Eliminar Tienda
window.deleteStore = async (id) => {
    if(!confirm("¿Estás seguro de eliminar esta tienda? Esta acción NO se puede deshacer y borrará todo su catálogo y ventas.")) return;

    const { error } = await supabase.from('stores').delete().eq('id', id);
    if(error) return alert("Error al eliminar la tienda: " + error.message);

    loadStores();
}

// 🔑 IMPERSONATE: Entrar como el cliente
window.impersonateStore = async (email, password, storeName) => {
    if (!email || !password) return alert("Esta tienda no tiene credenciales válidas guardadas.");
    if (!confirm(`¿Iniciar sesión mágicamente como ${storeName}? Saldrás de tu sesión de administrador.`)) return;

    await supabase.auth.signOut();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
        alert("Error al iniciar sesión como cliente: " + error.message);
    } else {
        window.location.href = "index.html";
    }
};

// 🚪 Cerrar sesión
window.logout = async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
};

// ==========================================
// MODALES Y CREACIÓN
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

// ✏️ ABRIR MODAL DE EDICIÓN
window.openManageModal = (id) => {
    const store = allStores.find(s => s.id === id);
    if(!store) return;
    
    window.currentManageId = id;
    document.getElementById('manageStoreName').value = store.name;
    document.getElementById('manageStoreEmail').value = store.email || '';
    document.getElementById('manageStorePassword').value = store.password_text || '';
    document.getElementById('manageStorePassword').type = 'password';
    
    // Setear Datepicker
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
    if(input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
}

// 💾 GUARDAR CAMBIOS DE EDICIÓN
window.saveStoreChanges = async () => {
    const id = window.currentManageId;
    const name = document.getElementById('manageStoreName').value.trim();
    const email = document.getElementById('manageStoreEmail').value.trim();
    const password_text = document.getElementById('manageStorePassword').value;
    const dateVal = document.getElementById('manageStoreDate').value;

    if (!name) return alert("El nombre es obligatorio.");

    let expires_at = null;
    if (dateVal) {
        // Fijamos hora a mediodía para evitar saltos de zona horaria
        expires_at = new Date(`${dateVal}T12:00:00Z`).toISOString();
    }

    const btn = document.getElementById("btnSaveManage");
    const originalText = btn.innerText;
    btn.innerText = "Guardando...";
    btn.disabled = true;

    const { error } = await supabase
        .from("stores")
        .update({ name, email, password_text, expires_at })
        .eq("id", id);

    btn.innerText = originalText;
    btn.disabled = false;

    if (error) return alert("Error al actualizar la tienda: " + error.message);

    closeManageModal();
    loadStores();
};

// ✨ Crear tienda
window.createStore = async () => {
    const name = document.getElementById("newStoreName").value.trim();
    const email = document.getElementById("newStoreEmail").value.trim();
    const password = document.getElementById("newStorePassword").value;
    const btn = document.getElementById("btnCreate");

    if (!name || !email || password.length < 6) {
        alert("Completá todos los campos. La contraseña debe tener al menos 6 caracteres.");
        return;
    }

    btn.innerText = "Creando...";
    btn.disabled = true;

    const { data: authData, error: authError } = await authSupabase.auth.signUp({
        email,
        password
    });

    if (authError) {
        alert("Error al crear usuario: " + authError.message);
        btn.innerText = "Dar de Alta";
        btn.disabled = false;
        return;
    }

    if (!authData.user || authData.user.identities?.length === 0) {
        alert("Ese email ya está registrado en el sistema.");
        btn.innerText = "Dar de Alta";
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

    btn.innerText = "Dar de Alta";
    btn.disabled = false;

    if (dbError) {
        console.error(dbError);
        alert("Usuario creado en Auth, pero falló la BD: " + dbError.message + ". ¿Recordaste agregar las columnas email y password_text a tu tabla stores?");
        return;
    }

    closeModal();
    loadStores();
};

// 🚀 INIT
(async () => {
  const user = await checkAdmin();
  if (!user) return;
  loadStores();
})();