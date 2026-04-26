import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabaseUrl = "https://fxqomvjynncaigwoasqp.supabase.co";
const supabaseKey = "sb_publishable_Mwq88wTGFEHF9zvvM7xWmw_9FQmjlZO";
const supabase = createClient(supabaseUrl, supabaseKey);

const ADMIN_EMAIL = "admin@stockware.com"; 

window.login = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const loginBtn = document.getElementById("loginBtn");
  const originalText = "ingresar";

  // Activar loader
  loginBtn.disabled = true;
  loginBtn.innerHTML = `
    <svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    ingresando...
  `;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
      alert("Credenciales incorrectas o usuario no válido.");
      // Restaurar botón si hay error
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalText;
      return;
  }
  
  // 👑 Si es el jefe, lo mandamos al Panel Maestro
  if (data.user.email === ADMIN_EMAIL) {
      window.location.href = "admin.html";
      return;
  }

  // 🛒 Si es un cliente, verificamos su tienda
  const accessGranted = await checkStoreAccess(data.user.id);
  
  // Si no tiene acceso, restauramos el botón
  if (!accessGranted) {
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalText;
  }
};

async function checkStoreAccess(userId) {
  const { data: store, error } = await supabase
    .from("stores")
    .select("*")
    .eq("owner_id", userId)
    .single();

  if (error || !store) {
    alert("Tu usuario no tiene una tienda asignada. Contactá al administrador.");
    await supabase.auth.signOut();
    return false; // Retornamos false para que el login() sepa que falló
  }

  const isExpired = store.expires_at && new Date(store.expires_at) < new Date();
  if (!store.active || isExpired) {
    alert("Tu suscripción ha vencido o la tienda está inactiva.");
    await supabase.auth.signOut();
    return false;
  }

  localStorage.setItem("store_id", store.id);
  window.location.href = "pos.html";
  return true;
}

// Auto-login al abrir la app
(async () => {
  const { data } = await supabase.auth.getUser();
  if (data.user) {
      // Si el que está logueado es el admin, lo mandamos al admin (si no está ya ahí)
      if (data.user.email === ADMIN_EMAIL) {
          if (!window.location.pathname.includes("admin.html")) {
              window.location.href = "admin.html";
          }
      } else {
          // Si es cliente, verificamos su tienda normal
          if (!window.location.pathname.includes("pos.html") && !window.location.pathname.includes("products.html")) {
             checkStoreAccess(data.user.id);
          }
      }
  }
})();
