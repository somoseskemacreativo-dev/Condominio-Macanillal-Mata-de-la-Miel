// ============================================================================
// CONEXIÓN OFICIAL A SUPABASE - EDIFICIO MACANILLAL
// ============================================================================
const SUPABASE_URL = "https://xztnknngogcjrcmznejt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NxDEP9sWYqUlZDMrttsnwQ_vipxoZkw";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Credenciales exclusivas del Creador
const CREATOR_USER = "1988";
const CREATOR_PASS = "4VU03YZN6Y";

// Claves locales para mantener la sesión y el tema en el dispositivo
const LOCAL_KEYS = {
  SESSION: "macanillal_session_v2",
  THEME: "macanillal_theme_v2"
};

let state = {
  loading: true,
  authTab: "login",
  ownerView: "profile",
  message: "",
  config: {
    condo_fee_usd: 0,
    extra_active: false,
    extra_title: "Cuota Extra",
    extra_limit_usd: 0,
    exchange_rate_bs: 1,
    period: ""
  },
  users: [],
  payments: []
};

function getSession() {
  return JSON.parse(localStorage.getItem(LOCAL_KEYS.SESSION) || "null");
}

function setSession(session) {
  if (session) {
    localStorage.setItem(LOCAL_KEYS.SESSION, JSON.stringify(session));
  } else {
    localStorage.removeItem(LOCAL_KEYS.SESSION);
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(LOCAL_KEYS.THEME) || "light";
  if (savedTheme === "dark") document.body.classList.add("dark");
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem(LOCAL_KEYS.THEME, isDark ? "dark" : "light");
}

function getCurrentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  return {
    period: `${year}-${month}`,
    min: `${year}-${month}-01`,
    max: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
    today: `${year}-${month}-${String(now.getDate()).padStart(2, "0")}`
  };
}

async function syncFromDatabase() {
  const bounds = getCurrentMonthBounds();

  try {
    let { data: cfg } = await db.from("config").select("*").eq("id", 1).single();

    if (!cfg) {
      const { data: inserted } = await db.from("config").insert([{
        id: 1,
        condo_fee_usd: 0,
        extra_active: false,
        extra_title: "Cuota Extra",
        extra_limit_usd: 0,
        exchange_rate_bs: 1,
        period: bounds.period
      }]).select().single();
      cfg = inserted;
    } else if (cfg.period !== bounds.period) {
      const { data: updated } = await db.from("config")
        .update({ period: bounds.period })
        .eq("id", 1)
        .select()
        .single();
      cfg = updated || cfg;
    }

    const [{ data: usersData }, { data: paymentsData }] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }),
      db.from("payments").select("*").order("created_at", { ascending: false })
    ]);

    state.config = cfg || state.config;
    state.users = usersData || [];
    state.payments = paymentsData || [];
    state.loading = false;
  } catch (err) {
    console.error("Error conectando con Supabase:", err);
    state.message = "Verifica que hayas ejecutado el código SQL en Supabase.";
    state.loading = false;
  }

  render();
}

function getCollectionStats() {
  const cfg = state.config;
  const rate = Number(cfg.exchange_rate_bs) > 0 ? Number(cfg.exchange_rate_bs) : 1;

  const condoPayments = state.payments.filter(p => p.type === "condo" && p.period === cfg.period);
  const extraPayments = state.payments.filter(p => p.type === "extra");

  const condoCollectedBs = condoPayments.reduce((acc, p) => acc + Number(p.amount_bs || 0), 0);
  const extraCollectedBs = extraPayments.reduce((acc, p) => acc + Number(p.amount_bs || 0), 0);

  const condoCollectedUSD = condoCollectedBs / rate;
  const extraCollectedUSD = extraCollectedBs / rate;

  const condoGoalUSD = Number(cfg.condo_fee_usd) || 0;
  const extraGoalUSD = Number(cfg.extra_limit_usd) || 0;

  const condoPercent = condoGoalUSD > 0 ? Math.min(100, Math.round((condoCollectedUSD / condoGoalUSD) * 100)) : 0;
  const extraPercent = extraGoalUSD > 0 ? Math.min(100, Math.round((extraCollectedUSD / extraGoalUSD) * 100)) : 0;

  return {
    condoCollectedUSD,
    condoGoalUSD,
    condoPercent,
    extraCollectedUSD,
    extraGoalUSD,
    extraPercent
  };
}

function render() {
  const root = document.getElementById("appRoot");
  const session = getSession();
  const logoutWrap = document.getElementById("logoutWrap");

  if (state.loading) {
    root.innerHTML = `<div class="card"><p class="muted">Sincronizando datos del Edificio Macanillal...</p></div>`;
    return;
  }

  if (!session) {
    logoutWrap.style.display = "none";
    root.innerHTML = renderAuthView();
    bindAuthEvents();
    return;
  }

  logoutWrap.style.display = "block";

  if (session.role === "creator") {
    root.innerHTML = renderCreatorView();
    bindCreatorEvents();
    return;
  }

  const currentUser = state.users.find(u => u.apt.toLowerCase() === session.apt.toLowerCase());

  if (!currentUser) {
    setSession(null);
    render();
    return;
  }

  if (currentUser.status !== "approved") {
    root.innerHTML = renderWaitingView(currentUser);
    bindWaitingEvents();
    return;
  }

  root.innerHTML = renderOwnerView(currentUser);
  bindOwnerEvents(currentUser);
}

function renderAuthView() {
  return `
    <div class="card">
      <div class="tabs">
        <button class="tab-btn ${state.authTab === "login" ? "active" : ""}" id="tabLogin">Iniciar Sesión</button>
        <button class="tab-btn ${state.authTab === "register" ? "active" : ""}" id="tabRegister">Registrarse</button>
      </div>

      ${state.message ? `<div class="alert">${state.message}</div>` : ""}

      ${state.authTab === "login" ? `
        <form id="formLogin">
          <div class="field">
            <label>Apartamento</label>
            <input type="text" id="loginApt" placeholder="Ej: 1905" required />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <div class="input-wrap">
              <input type="password" id="loginPass" placeholder="Contraseña" required />
              <button type="button" class="eye-btn" data-toggle="loginPass">👁</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Entrar</button>
          <button type="button" class="link-btn" id="btnGoRecover">¿Olvidaste tu clave?</button>
        </form>
      ` : ""}

      ${state.authTab === "register" ? `
        <form id="formRegister">
          <div class="field">
            <label>Nombre y Apellido</label>
            <input type="text" id="regName" placeholder="Nombre completo" required />
          </div>
          <div class="field" style="display:flex; gap:8px;">
            <div style="flex:1;">
              <label>Piso</label>
              <input type="text" id="regFloor" placeholder="Ej: 19" required />
            </div>
            <div style="flex:1;">
              <label>Apartamento</label>
              <input type="text" id="regApt" placeholder="Ej: 1905" required />
            </div>
          </div>
          <div class="field">
            <label>Correo Electrónico</label>
            <input type="email" id="regEmail" placeholder="correo@ejemplo.com" required />
          </div>
          <div class="field">
            <label>Teléfono (WhatsApp Edificio Macanillal)</label>
            <input type="tel" id="regPhone" placeholder="+584120000000" required />
          </div>
          <div class="field">
            <label>Clave de acceso (6 números)</label>
            <div class="input-wrap">
              <input type="password" id="regPass1" inputmode="numeric" maxlength="6" placeholder="6 dígitos numéricos" required />
              <button type="button" class="eye-btn" data-toggle="regPass1">👁</button>
            </div>
          </div>
          <div class="field">
            <label>Repetir clave (6 números)</label>
            <div class="input-wrap">
              <input type="password" id="regPass2" inputmode="numeric" maxlength="6" placeholder="Repite los 6 dígitos" required />
              <button type="button" class="eye-btn" data-toggle="regPass2">👁</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary" id="btnSubmitRegister">Registrar</button>
        </form>
      ` : ""}

      ${state.authTab === "recover" ? `
        <form id="formRecover">
          <div class="field">
            <label>Apartamento registrado</label>
            <input type="text" id="recApt" placeholder="Ej: 1905" required />
          </div>
          <div class="field">
            <label>Canal de recuperación</label>
            <select id="recChannel">
              <option value="whatsapp">WhatsApp de Administración</option>
              <option value="email">Correo Electrónico</option>
            </select>
          </div>
          <button type="submit" class="btn btn-secondary">Solicitar Recuperación</button>
          <button type="button" class="btn btn-outline" id="btnBackLogin">Volver al Login</button>
        </form>
      ` : ""}
    </div>
  `;
}

function renderWaitingView(user) {
  return `
    <div class="card">
      <h2 style="font-size:1.1rem; margin-bottom:8px;">Perfil en Lista de Espera</h2>
      <p class="muted" style="margin-bottom:14px;">
        Hola <strong>${user.name}</strong> (Apto. <strong>${user.apt}</strong>). Tu registro está pendiente por verificación y aprobación del Creador.
      </p>
      <div class="list-item">
        <div class="row-between">
          <span>Piso / Apto:</span>
          <strong>Piso ${user.floor} - ${user.apt}</strong>
        </div>
        <div class="row-between" style="margin-top:6px;">
          <span>WhatsApp:</span>
          <strong>${user.phone}</strong>
        </div>
        <div class="row-between" style="margin-top:6px;">
          <span>Estado:</span>
          <strong style="color:var(--secondary);">Esperando aprobación</strong>
        </div>
      </div>
      <button class="btn btn-outline" id="btnCheckApproval">Verificar si ya fui aprobado</button>
    </div>
  `;
}

function renderCollectionBars() {
  const cfg = state.config;
  const stats = getCollectionStats();

  return `
    <div class="card">
      <div class="top-banner">
        <div>
          <div class="muted">Monto Condominio Mensual</div>
          <strong>Recolección (${cfg.period})</strong>
        </div>
        <div class="amount-badge">$${Number(cfg.condo_fee_usd).toFixed(2)}</div>
      </div>

      <div class="progress-track">
        <div class="progress-fill" style="width: ${stats.condoPercent}%;"></div>
      </div>
      <div class="row-between muted">
        <span>Recaudado: $${stats.condoCollectedUSD.toFixed(2)}</span>
        <span>${stats.condoPercent}%</span>
      </div>

      ${cfg.extra_active ? `
        <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
          <div class="row-between">
            <strong>${cfg.extra_title || "Cuota Extra"}</strong>
            <strong style="color:var(--secondary);">Meta: $${Number(cfg.extra_limit_usd).toFixed(2)}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill extra" style="width: ${stats.extraPercent}%;"></div>
          </div>
          <div class="row-between muted">
            <span>Recaudado: $${stats.extraCollectedUSD.toFixed(2)}</span>
            <span>${stats.extraPercent}%</span>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function renderOwnerView(user) {
  const cfg = state.config;
  const bounds = getCurrentMonthBounds();
  const myPayments = state.payments.filter(p => p.apt === user.apt);

  if (state.ownerView === "pay-condo" || state.ownerView === "pay-extra") {
    const isExtra = state.ownerView === "pay-extra";
    return `
      ${renderCollectionBars()}
      <div class="card">
        <h3 style="margin-bottom:12px;">${isExtra ? "Cargar Pago de Cuota Extra" : "Cargar Pago de Condominio"}</h3>
        ${state.message ? `<div class="alert">${state.message}</div>` : ""}
        <form id="formPayment" data-type="${isExtra ? "extra" : "condo"}">
          <div class="field">
            <label>Comprobante de pago (Capture)</label>
            <input type="file" id="payFile" accept="image/*" required />
          </div>
          <div class="field">
            <label>Últimos 4 dígitos de la referencia (Obligatorio)</label>
            <input type="text" id="payRef" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Ej: 4829" required />
          </div>
          <div class="field">
            <label>Monto pagado en Bolívares (Bs.)</label>
            <input type="number" step="0.01" min="0.01" id="payAmountBs" placeholder="Ej: 1850.00" required />
          </div>
          <div class="field">
            <label>Fecha del pago (Mes y año actual)</label>
            <input type="date" id="payDate" min="${bounds.min}" max="${bounds.max}" value="${bounds.today}" required />
          </div>
          <button type="submit" class="btn btn-accent" id="btnSubmitPay">Enviar pago</button>
          <button type="button" class="btn btn-outline" id="btnBackProfile">Atrás</button>
        </form>
      </div>
    `;
  }

  return `
    ${renderCollectionBars()}

    <div class="card">
      <div class="row-between" style="margin-bottom:8px;">
        <strong>${user.name}</strong>
        <span class="muted">Piso ${user.floor} • Apto ${user.apt}</span>
      </div>
      <div class="muted">${user.email} • ${user.phone}</div>

      ${state.message ? `<div class="alert" style="margin-top:12px;">${state.message}</div>` : ""}

      <div style="margin-top:14px; display:flex; flex-direction:column; gap:8px;">
        <button class="btn btn-primary" id="btnGoPayCondo">Subir Comprobante Condominio</button>
        ${cfg.extra_active ? `
          <button class="btn btn-secondary" id="btnGoPayExtra">Subir Comprobante Cuota Extra</button>
        ` : ""}
      </div>
    </div>

    <div class="card">
      <strong style="display:block; margin-bottom:10px;">Mis Pagos Cargados</strong>
      ${myPayments.length === 0 ? `<p class="muted">Aún no has cargado comprobantes.</p>` : myPayments.map(p => `
        <div class="list-item">
          <div class="row-between">
            <strong>${p.type === "extra" ? "Cuota Extra" : "Condominio"} (Ref: ${p.ref})</strong>
            <strong>Bs. ${Number(p.amount_bs).toFixed(2)}</strong>
          </div>
          <div class="row-between muted" style="margin-top:4px;">
            <span>Fecha: ${p.date}</span>
            ${p.receipt_url ? `<a href="${p.receipt_url}" target="_blank" style="color:var(--accent); font-weight:600;">Ver Capture</a>` : `<span>Cargado ✓</span>`}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderCreatorView() {
  const cfg = state.config;
  const pendingUsers = state.users.filter(u => u.status === "pending");
  const approvedUsers = state.users.filter(u => u.status === "approved");

  return `
    ${renderCollectionBars()}

    <div class="card">
      <strong style="display:block; margin-bottom:12px;">Configuración de Recolección (Creador)</strong>
      ${state.message ? `<div class="alert">${state.message}</div>` : ""}
      <form id="formCreatorConfig">
        <div class="field">
          <label>Monto Condominio Mensual ($ USD)</label>
          <input type="number" step="0.01" min="0" id="cfgCondoUSD" value="${cfg.condo_fee_usd}" required />
        </div>
        <div class="field">
          <label>Tasa referencial (Bs. por $1 USD para cálculo de barra)</label>
          <input type="number" step="0.01" min="0.01" id="cfgRateBs" value="${cfg.exchange_rate_bs}" required />
        </div>
        <div class="field" style="margin-top:10px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="cfgExtraActive" style="width:auto;" ${cfg.extra_active ? "checked" : ""} />
            Activar barra de Cuota Extra
          </label>
        </div>
        <div class="field">
          <label>Monto límite Cuota Extra ($ USD)</label>
          <input type="number" step="0.01" min="0" id="cfgExtraUSD" value="${cfg.extra_limit_usd}" />
        </div>
        <button type="submit" class="btn btn-primary">Guardar Configuración</button>
      </form>
    </div>

    <div class="card">
      <strong style="display:block; margin-bottom:10px;">Lista de Espera (${pendingUsers.length})</strong>
      ${pendingUsers.length === 0 ? `<p class="muted">No hay propietarios pendientes por verificar.</p>` : pendingUsers.map(u => `
        <div class="list-item">
          <div class="row-between">
            <strong>Apto ${u.apt} (Piso ${u.floor}) - ${u.name}</strong>
          </div>
          <div class="muted" style="margin:4px 0 8px;">${u.email} • ${u.phone}</div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-accent" style="padding:8px;" data-approve="${u.apt}">Aprobar Acceso</button>
            <button class="btn btn-outline" style="padding:8px; margin-top:0;" data-reject="${u.apt}">Rechazar</button>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="card">
      <strong style="display:block; margin-bottom:10px;">Balance y Exportación (${state.payments.length} pagos)</strong>
      <button class="btn btn-accent" id="btnExportExcel">Exportar Balance a Excel (.CSV)</button>
      <div style="margin-top:12px;">
        ${state.payments.length === 0 ? `<p class="muted">No se han registrado pagos todavía.</p>` : state.payments.map(p => `
          <div class="list-item">
            <div class="row-between">
              <strong>Apto ${p.apt} • ${p.owner_name}</strong>
              <strong>Bs. ${Number(p.amount_bs).toFixed(2)}</strong>
            </div>
            <div class="row-between muted" style="margin-top:4px;">
              <span>Ref: ${p.ref} (${p.type === "extra" ? "Cuota Extra" : "Condominio"})</span>
              <span>${p.date} ${p.receipt_url ? `• <a href="${p.receipt_url}" target="_blank" style="color:var(--accent);">Capture</a>` : ""}</span>
            </div>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="card">
      <strong style="display:block; margin-bottom:8px;">Propietarios Verificados (${approvedUsers.length})</strong>
      ${approvedUsers.length === 0 ? `<p class="muted">Sin propietarios aprobados aún.</p>` : approvedUsers.map(u => `
        <div class="list-item">
          <div class="row-between">
            <strong>Apto ${u.apt} (Piso ${u.floor})</strong>
            <span>${u.name}</span>
          </div>
          <div class="muted">${u.phone} • ${u.email}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function bindWaitingEvents() {
  const btn = document.getElementById("btnCheckApproval");
  if (btn) {
    btn.onclick = async () => {
      btn.textContent = "Verificando...";
      await syncFromDatabase();
    };
  }
}

function bindAuthEvents() {
  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");

  if (tabLogin) {
    tabLogin.onclick = () => {
      state.authTab = "login";
      state.message = "";
      render();
    };
  }
  if (tabRegister) {
    tabRegister.onclick = () => {
      state.authTab = "register";
      state.message = "";
      render();
    };
  }

  document.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.onclick = () => {
      const input = document.getElementById(btn.getAttribute("data-toggle"));
      if (input) input.type = input.type === "password" ? "text" : "password";
    };
  });

  const btnGoRecover = document.getElementById("btnGoRecover");
  if (btnGoRecover) {
    btnGoRecover.onclick = () => {
      state.authTab = "recover";
      state.message = "";
      render();
    };
  }

  const btnBackLogin = document.getElementById("btnBackLogin");
  if (btnBackLogin) {
    btnBackLogin.onclick = () => {
      state.authTab = "login";
      state.message = "";
      render();
    };
  }

  const formLogin = document.getElementById("formLogin");
  if (formLogin) {
    formLogin.onsubmit = async (e) => {
      e.preventDefault();
      const apt = document.getElementById("loginApt").value.trim();
      const pass = document.getElementById("loginPass").value.trim();

      if (apt === CREATOR_USER && pass === CREATOR_PASS) {
        setSession({ role: "creator", apt: CREATOR_USER });
        state.message = "";
        await syncFromDatabase();
        return;
      }

      await syncFromDatabase();
      const found = state.users.find(u => u.apt.toLowerCase() === apt.toLowerCase() && u.password === pass);

      if (!found) {
        state.message = "Apartamento o contraseña incorrectos.";
        render();
        return;
      }

      setSession({ role: "owner", apt: found.apt });
      state.message = "";
      render();
    };
  }

  const formRegister = document.getElementById("formRegister");
  if (formRegister) {
    formRegister.onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById("regName").value.trim();
      const floor = document.getElementById("regFloor").value.trim();
      const apt = document.getElementById("regApt").value.trim().toUpperCase();
      const email = document.getElementById("regEmail").value.trim();
      const phone = document.getElementById("regPhone").value.trim();
      const pass1 = document.getElementById("regPass1").value.trim();
      const pass2 = document.getElementById("regPass2").value.trim();

      if (apt === CREATOR_USER) {
        state.message = "Este código está reservado.";
        render();
        return;
      }

      if (!/^\d{6}$/.test(pass1)) {
        state.message = "La contraseña debe tener exactamente 6 dígitos numéricos.";
        render();
        return;
      }

      if (pass1 !== pass2) {
        state.message = "Las contraseñas no coinciden.";
        render();
        return;
      }

      const btn = document.getElementById("btnSubmitRegister");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Registrando...";
      }

      const { data: existing } = await db.from("users").select("apt").ilike("apt", apt).maybeSingle();
      if (existing) {
        state.message = `Ya existe un perfil registrado para el apartamento ${apt}. No se permiten dos perfiles por apartamento.`;
        render();
        return;
      }

      const { error } = await db.from("users").insert([{
        apt,
        name,
        floor,
        email,
        phone,
        password: pass1,
        status: "pending"
      }]);

      if (error) {
        state.message = "No se pudo completar el registro. Verifica que ejecutaste el SQL en Supabase.";
        render();
        return;
      }

      setSession({ role: "owner", apt });
      state.message = "";
      await syncFromDatabase();
    };
  }

  const formRecover = document.getElementById("formRecover");
  if (formRecover) {
    formRecover.onsubmit = (e) => {
      e.preventDefault();
      const apt = document.getElementById("recApt").value.trim();
      const channel = document.getElementById("recChannel").value;
      const found = state.users.find(u => u.apt.toLowerCase() === apt.toLowerCase());

      if (!found) {
        state.message = "No se encontró un perfil asociado a ese apartamento.";
        render();
        return;
      }

      if (channel === "whatsapp") {
        const msg = encodeURIComponent(`Hola administración Edificio Macanillal, solicito recuperar la clave del apartamento ${found.apt} (${found.name}).`);
        window.open(`https://wa.me/+584123623243?text=${msg}`, "_blank");
      } else {
        window.location.href = `mailto:${found.email}?subject=Recuperacion%20Condominio%20Macanillal&body=Solicitud%20de%20recuperacion%20de%20clave%20Apto%20${found.apt}`;
      }
    };
  }
}

function bindOwnerEvents(user) {
  const btnGoPayCondo = document.getElementById("btnGoPayCondo");
  if (btnGoPayCondo) {
    btnGoPayCondo.onclick = () => {
      state.ownerView = "pay-condo";
      state.message = "";
      render();
    };
  }

  const btnGoPayExtra = document.getElementById("btnGoPayExtra");
  if (btnGoPayExtra) {
    btnGoPayExtra.onclick = () => {
      state.ownerView = "pay-extra";
      state.message = "";
      render();
    };
  }

  const btnBackProfile = document.getElementById("btnBackProfile");
  if (btnBackProfile) {
    btnBackProfile.onclick = () => {
      state.ownerView = "profile";
      state.message = "";
      render();
    };
  }

  const formPayment = document.getElementById("formPayment");
  if (formPayment) {
    formPayment.onsubmit = async (e) => {
      e.preventDefault();
      const type = formPayment.getAttribute("data-type");
      const fileInput = document.getElementById("payFile");
      const ref = document.getElementById("payRef").value.trim();
      const amountBs = parseFloat(document.getElementById("payAmountBs").value);
      const date = document.getElementById("payDate").value;

      if (!fileInput.files || fileInput.files.length === 0) {
        state.message = "Selecciona la imagen del comprobante.";
        render();
        return;
      }

      if (!/^\d{4}$/.test(ref)) {
        state.message = "Coloca obligatoriamente los últimos 4 dígitos numéricos de la referencia.";
        render();
        return;
      }

      const bounds = getCurrentMonthBounds();
      if (date < bounds.min || date > bounds.max) {
        state.message = "La fecha debe pertenecer al mes y año actual.";
        render();
        return;
      }

      const btn = document.getElementById("btnSubmitPay");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Subiendo comprobante...";
      }

      const file = fileInput.files[0];
      const ext = file.name.split(".").pop();
      const filePath = `${bounds.period}/apto_${user.apt}_${Date.now()}.${ext}`;

      let receiptUrl = "";
      const { error: uploadErr } = await db.storage.from("captures").upload(filePath, file);
      if (!uploadErr) {
        const { data: pubUrl } = db.storage.from("captures").getPublicUrl(filePath);
        receiptUrl = pubUrl?.publicUrl || "";
      }

      const { error: insertErr } = await db.from("payments").insert([{
        apt: user.apt,
        floor: user.floor,
        owner_name: user.name,
        owner_phone: user.phone,
        owner_email: user.email,
        type,
        ref,
        amount_bs: amountBs,
        date,
        period: bounds.period,
        receipt_url: receiptUrl
      }]);

      if (insertErr) {
        state.message = "Error al guardar el pago. Intenta nuevamente.";
        render();
        return;
      }

      state.ownerView = "profile";
      state.message = "Pago enviado y barra de recolección actualizada.";
      await syncFromDatabase();
    };
  }
}

function bindCreatorEvents() {
  const formCreatorConfig = document.getElementById("formCreatorConfig");
  if (formCreatorConfig) {
    formCreatorConfig.onsubmit = async (e) => {
      e.preventDefault();
      const condo_fee_usd = parseFloat(document.getElementById("cfgCondoUSD").value) || 0;
      const exchange_rate_bs = parseFloat(document.getElementById("cfgRateBs").value) || 1;
      const extra_active = document.getElementById("cfgExtraActive").checked;
      const extra_limit_usd = parseFloat(document.getElementById("cfgExtraUSD").value) || 0;

      const { error } = await db.from("config").update({
        condo_fee_usd,
        exchange_rate_bs,
        extra_active,
        extra_limit_usd
      }).eq("id", 1);

      state.message = error ? "Error al guardar configuración." : "Configuración actualizada para todos los propietarios.";
      await syncFromDatabase();
    };
  }

  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      const apt = btn.getAttribute("data-approve");
      await db.from("users").update({ status: "approved" }).eq("apt", apt);
      state.message = `Acceso aprobado para el apartamento ${apt}.`;
      await syncFromDatabase();
    };
  });

  document.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      const apt = btn.getAttribute("data-reject");
      await db.from("users").delete().eq("apt", apt);
      state.message = `Solicitud del apartamento ${apt} eliminada.`;
      await syncFromDatabase();
    };
  });

  const btnExportExcel = document.getElementById("btnExportExcel");
  if (btnExportExcel) {
    btnExportExcel.onclick = () => {
      const headers = [
        "Propietario",
        "Referencia de pago cargado (ultimos 4 digitos)",
        "Monto pagado (Bs)",
        "Fecha de pago"
      ];

      const rows = state.payments.map(p => {
        const ownerInfo = `${p.owner_name} - Piso ${p.floor} Apto ${p.apt} (${p.owner_phone} / ${p.owner_email})`;
        return [
          `"${ownerInfo.replace(/"/g, '""')}"`,
          `"${p.ref}"`,
          Number(p.amount_bs).toFixed(2),
          `"${p.date}"`
        ].join(";");
      });

      const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Balance_Condominio_Macanillal_${getCurrentMonthBounds().period}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  await syncFromDatabase();

  db.channel("macanillal-realtime")
    .on("postgres_changes", { event: "*", schema: "public" }, () => {
      syncFromDatabase();
    })
    .subscribe();

  const settingsModal = document.getElementById("settingsModal");
  document.getElementById("btnSettings").onclick = () => settingsModal.classList.add("open");
  document.getElementById("btnCloseSettings").onclick = () => settingsModal.classList.remove("open");
  document.getElementById("btnToggleTheme").onclick = () => toggleTheme();

  document.getElementById("btnLogout").onclick = () => {
    setSession(null);
    state.authTab = "login";
    state.ownerView = "profile";
    state.message = "";
    settingsModal.classList.remove("open");
    render();
  };
});