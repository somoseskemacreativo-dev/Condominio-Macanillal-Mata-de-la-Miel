// ============================================================================
// CONEXIÓN OFICIAL A SUPABASE - EDIFICIO MACANILLAL
// ============================================================================
const SUPABASE_URL = "https://xztnknngogcjrcmznejt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NxDEP9sWYqUlZDMrttsnwQ_vipxoZkw";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Credenciales exclusivas del Creador
const CREATOR_USER = "1988";
const CREATOR_PASS = "4VU03YZN6Y";
const TOTAL_APARTMENTS = 95;

const LOCAL_KEYS = {
  SESSION: "macanillal_session_v3",
  THEME: "macanillal_theme_v3"
};

let state = {
  loading: true,
  authTab: "login",
  ownerView: "profile", // 'profile' | 'pay-condo' | 'pay-extra'
  creatorTab: "config", // 'config' | 'mora' | 'locales' | 'waitlist' | 'balance'
  message: "",
  config: {
    condo_fee_usd: 0,
    extra_active: false,
    extra_title: "Cuota Extra",
    extra_limit_usd: 0,
    exchange_rate_bs: 1,
    period: "",
    total_apartments: 95,
    initial_accumulated_usd: 0,
    party_room_active: true
  },
  users: [],
  payments: [],
  debts: [],
  locals: [],
  specialIncomes: []
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

function getTodayInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    period: `${year}-${month}`,
    today: `${year}-${month}-${day}`
  };
}

// Sincronización completa con Supabase
async function syncFromDatabase() {
  const { period } = getTodayInfo();

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
        period,
        total_apartments: TOTAL_APARTMENTS,
        initial_accumulated_usd: 0,
        party_room_active: true
      }]).select().single();
      cfg = inserted;
    } else if (cfg.period !== period) {
      // Reinicio mensual el 1ro de cada mes
      const { data: updated } = await db.from("config")
        .update({ period })
        .eq("id", 1)
        .select()
        .single();
      cfg = updated || cfg;
    }

    const [
      { data: usersData },
      { data: paymentsData },
      { data: debtsData },
      { data: localsData },
      { data: specialData }
    ] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }),
      db.from("payments").select("*").order("created_at", { ascending: false }),
      db.from("debts").select("*").order("period", { ascending: true }),
      db.from("locals").select("*").order("id", { ascending: true }),
      db.from("special_incomes").select("*").order("date", { ascending: false })
    ]);

    state.config = cfg || state.config;
    state.users = usersData || [];
    state.payments = paymentsData || [];
    state.debts = debtsData || [];
    state.locals = localsData || [
      { id: "Local 1", assigned_apt: "", monthly_fee_usd: 0 },
      { id: "Local 2", assigned_apt: "", monthly_fee_usd: 0 },
      { id: "Local 3", assigned_apt: "", monthly_fee_usd: 0 }
    ];
    state.specialIncomes = specialData || [];
    state.loading = false;
  } catch (err) {
    console.error("Error sincronizando:", err);
    state.message = "Asegúrate de haber ejecutado el nuevo SQL en Supabase.";
    state.loading = false;
  }

  render();
}

// Obtener el desglose de obligaciones de un propietario (FIFO: del más antiguo al más reciente)
function getOwnerObligations(apt) {
  const cfg = state.config;
  const rate = Number(cfg.exchange_rate_bs) > 0 ? Number(cfg.exchange_rate_bs) : 1;

  // 1. Deudas anteriores (Mora) ordenadas por periodo más antiguo primero
  const ownerDebts = state.debts
    .filter(d => d.apt.toLowerCase() === apt.toLowerCase() && d.status !== "paid")
    .sort((a, b) => a.period.localeCompare(b.period));

  const moraItems = ownerDebts.map(d => {
    const totalUSD = Number(d.amount_usd) || 0;
    const paidUSD = Number(d.paid_usd) || 0;
    const remainingUSD = Math.max(0, Number((totalUSD - paidUSD).toFixed(2)));
    return {
      key: `debt_${d.id}`,
      debtId: d.id,
      period: d.period,
      label: `Mora: ${d.concept} (${d.period})`,
      totalUSD,
      paidUSD,
      remainingUSD,
      remainingBs: Number((remainingUSD * rate).toFixed(2)),
      isMora: true
    };
  }).filter(item => item.remainingUSD > 0.01);

  // 2. Cuota del mes actual (Condominio Apto + Locales asignados a este apartamento)
  const assignedLocals = state.locals.filter(
    l => l.assigned_apt && l.assigned_apt.toLowerCase() === apt.toLowerCase()
  );
  const localsFeeUSD = assignedLocals.reduce((acc, l) => acc + Number(l.monthly_fee_usd || 0), 0);
  const currentMonthFeeUSD = (Number(cfg.condo_fee_usd) || 0) + localsFeeUSD;

  // Pagos hechos al periodo actual (que no sean de mora anterior)
  const currentMonthPayments = state.payments.filter(
    p => p.apt.toLowerCase() === apt.toLowerCase() &&
         p.type === "condo" &&
         (p.target_period === cfg.period || (!p.target_period && p.period === cfg.period)) &&
         !p.debt_id
  );

  const currentMonthPaidUSD = currentMonthPayments.reduce((acc, p) => {
    const usd = Number(p.amount_usd) > 0 ? Number(p.amount_usd) : (Number(p.amount_bs || 0) / rate);
    return acc + usd;
  }, 0);

  const currentRemainingUSD = Math.max(0, Number((currentMonthFeeUSD - currentMonthPaidUSD).toFixed(2)));

  const currentItem = {
    key: `current_${cfg.period}`,
    debtId: null,
    period: cfg.period,
    label: `Condominio Mes Actual (${cfg.period})${assignedLocals.length ? " + " + assignedLocals.map(l => l.id).join(", ") : ""}`,
    totalUSD: currentMonthFeeUSD,
    paidUSD: Math.min(currentMonthFeeUSD, currentMonthPaidUSD),
    remainingUSD: currentRemainingUSD,
    remainingBs: Number((currentRemainingUSD * rate).toFixed(2)),
    isMora: false
  };

  const allPending = [...moraItems];
  if (currentItem.remainingUSD > 0.01) {
    allPending.push(currentItem);
  }

  return {
    hasMora: moraItems.length > 0,
    moraItems,
    currentItem,
    assignedLocals,
    allPending,
    oldestPayable: allPending.length > 0 ? allPending[0] : null,
    totalPendingUSD: allPending.reduce((acc, i) => acc + i.remainingUSD, 0)
  };
}

// Estadísticas Globales del Edificio (95 Apartamentos + 3 Locales + Salón de Fiesta + Acumulado Inicial)
function getBuildingStats() {
  const cfg = state.config;
  const rate = Number(cfg.exchange_rate_bs) > 0 ? Number(cfg.exchange_rate_bs) : 1;

  const aptsGoalUSD = TOTAL_APARTMENTS * (Number(cfg.condo_fee_usd) || 0);
  const localsGoalUSD = state.locals.reduce((acc, l) => acc + Number(l.monthly_fee_usd || 0), 0);
  const globalMonthlyGoalUSD = aptsGoalUSD + localsGoalUSD;

  // Ingresos por pagos de propietarios (Condominio y Mora)
  const ownerCondoUSD = state.payments
    .filter(p => p.type === "condo")
    .reduce((acc, p) => {
      const usd = Number(p.amount_usd) > 0 ? Number(p.amount_usd) : (Number(p.amount_bs || 0) / rate);
      return acc + usd;
    }, 0);

  // Ingresos especiales (Alquileres de Salón de Fiesta y pagos manuales de Locales 1, 2 y 3)
  const specialUSD = state.specialIncomes.reduce((acc, s) => acc + Number(s.amount_usd || 0), 0);

  // Condición inicial acumulada cargada por el creador
  const initialUSD = Number(cfg.initial_accumulated_usd) || 0;

  const globalCollectedUSD = initialUSD + ownerCondoUSD + specialUSD;
  const globalPercent = globalMonthlyGoalUSD > 0
    ? Math.min(100, Math.round((globalCollectedUSD / globalMonthlyGoalUSD) * 100))
    : 0;

  // Cuota Extra
  const extraPaymentsUSD = state.payments
    .filter(p => p.type === "extra")
    .reduce((acc, p) => {
      const usd = Number(p.amount_usd) > 0 ? Number(p.amount_usd) : (Number(p.amount_bs || 0) / rate);
      return acc + usd;
    }, 0);
  const extraGoalUSD = Number(cfg.extra_limit_usd) || 0;
  const extraPercent = extraGoalUSD > 0
    ? Math.min(100, Math.round((extraPaymentsUSD / extraGoalUSD) * 100))
    : 0;

  return {
    globalMonthlyGoalUSD,
    globalCollectedUSD,
    globalPercent,
    extraGoalUSD,
    extraPaymentsUSD,
    extraPercent
  };
}

// Renderizado Principal
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

// Vista: Login / Registro
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

// Vista: Lista de Espera
function renderWaitingView(user) {
  return `
    <div class="card">
      <h2 style="font-size:1.1rem; margin-bottom:8px;">Perfil en Lista de Espera</h2>
      <p class="muted" style="margin-bottom:14px;">
        Hola <strong>${user.name}</strong> (Apto. <strong>${user.apt}</strong>). Tu registro está pendiente por verificación del Creador.
      </p>
      <div class="list-item">
        <div class="row-between">
          <span>Piso / Apto:</span>
          <strong>Piso ${user.floor} - ${user.apt}</strong>
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

// Bloque común: Barra Global del Edificio (95 apartamentos) + Tabla de Locales y Salón de Fiesta
function renderGlobalBuildingCard() {
  const cfg = state.config;
  const bStats = getBuildingStats();

  return `
    <div class="card">
      <div class="top-banner">
        <div>
          <div class="muted">Recolección Global (${TOTAL_APARTMENTS} Aptos + Locales + Salón)</div>
          <strong>Fondo General del Edificio (${cfg.period})</strong>
        </div>
        <div class="amount-badge">$${bStats.globalMonthlyGoalUSD.toFixed(2)}</div>
      </div>

      <div class="progress-track">
        <div class="progress-fill" style="width: ${bStats.globalPercent}%;"></div>
      </div>
      <div class="row-between muted">
        <span>Total Disponible / Recaudado: <strong>$${bStats.globalCollectedUSD.toFixed(2)}</strong></span>
        <span>${bStats.globalPercent}%</span>
      </div>

      ${cfg.extra_active ? `
        <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border);">
          <div class="row-between">
            <strong>${cfg.extra_title || "Cuota Extra"}</strong>
            <strong style="color:var(--secondary);">Meta: $${bStats.extraGoalUSD.toFixed(2)}</strong>
          </div>
          <div class="progress-track">
            <div class="progress-fill extra" style="width: ${bStats.extraPercent}%;"></div>
          </div>
          <div class="row-between muted">
            <span>Recaudado: $${bStats.extraPaymentsUSD.toFixed(2)}</span>
            <span>${bStats.extraPercent}%</span>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

// Bloque común visible en todos los perfiles: Horario del Salón de Fiesta y Pagos de Locales 1, 2 y 3
function renderTransparencyTablesCard() {
  const cfg = state.config;
  const salonList = state.specialIncomes.filter(s => s.category === "salon");
  const localPayments = state.specialIncomes.filter(s => s.category === "local");

  return `
    <div class="card">
      <strong style="display:block; margin-bottom:6px;">Locales Comerciales (1, 2 y 3)</strong>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Local</th>
              <th>Asignado a</th>
              <th>Cuota Mensual</th>
            </tr>
          </thead>
          <tbody>
            ${state.locals.map(l => `
              <tr>
                <td><strong>${l.id}</strong></td>
                <td>${l.assigned_apt ? `Apto ${l.assigned_apt}` : "Pago Manual / Externo"}</td>
                <td>$${Number(l.monthly_fee_usd).toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      ${localPayments.length > 0 ? `
        <div class="muted" style="margin-top:8px; font-weight:600;">Pagos Registrados de Locales:</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Local</th>
                <th>Monto</th>
                <th>Método / Ref</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              ${localPayments.map(lp => `
                <tr>
                  <td>${lp.title}</td>
                  <td>$${Number(lp.amount_usd).toFixed(2)}</td>
                  <td>
                    ${lp.payment_method === "cash_usd" ? "Efectivo $ USD" : `Ref: ${lp.ref}`}
                    ${lp.receipt_url ? ` • <a href="${lp.receipt_url}" target="_blank" style="color:var(--accent);">Capture</a>` : ""}
                  </td>
                  <td>${lp.date}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : ""}

      ${cfg.party_room_active ? `
        <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--border);">
          <strong style="display:block; margin-bottom:6px;">Horario y Alquileres del Salón de Fiesta</strong>
          ${salonList.length === 0 ? `<p class="muted">No hay alquileres del salón de fiesta registrados actualmente.</p>` : `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Día / Fecha</th>
                    <th>Horario (7am - 11:59pm)</th>
                    <th>Monto</th>
                    <th>Pago</th>
                  </tr>
                </thead>
                <tbody>
                  ${salonList.map(s => `
                    <tr>
                      <td><strong>${s.day_of_week}</strong><br/><span class="muted">${s.date}</span></td>
                      <td>${s.start_time} - ${s.end_time}</td>
                      <td><strong>$${Number(s.amount_usd).toFixed(2)}</strong></td>
                      <td>
                        ${s.payment_method === "cash_usd" ? "Efectivo $" : `Ref: ${s.ref}`}
                        ${s.receipt_url ? `<br/><a href="${s.receipt_url}" target="_blank" style="color:var(--accent);">Ver Capture</a>` : ""}
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `}
        </div>
      ` : ""}
    </div>
  `;
}

// Vista del Propietario (con alerta de Mora en Rojo/Naranja, bloqueo de saldo a favor y botón de eliminar pago)
function renderOwnerView(user) {
  const cfg = state.config;
  const rate = Number(cfg.exchange_rate_bs) > 0 ? Number(cfg.exchange_rate_bs) : 1;
  const { today } = getTodayInfo();
  const ob = getOwnerObligations(user.apt);
  const myPayments = state.payments.filter(p => p.apt.toLowerCase() === user.apt.toLowerCase());

  const currentPercent = ob.currentItem.totalUSD > 0
    ? Math.min(100, Math.round((ob.currentItem.paidUSD / ob.currentItem.totalUSD) * 100))
    : 100;

  // Vista de formulario de carga de pago
  if (state.ownerView === "pay-condo" || state.ownerView === "pay-extra") {
    const isExtra = state.ownerView === "pay-extra";
    const oldest = ob.oldestPayable;

    return `
      <div class="card ${ob.hasMora && !isExtra ? "mora-card" : ""}">
        <h3 style="margin-bottom:10px;">
          ${isExtra ? "Cargar Pago de Cuota Extra" : "Cargar Pago de Condominio"}
        </h3>

        ${state.message ? `<div class="alert">${state.message}</div>` : ""}

        ${!isExtra && !oldest ? `
          <div class="alert">
            Estás solvente al 100% ($${ob.currentItem.totalUSD.toFixed(2)} cubiertos). No se permiten pagos por adelantado ni saldo a favor.
          </div>
          <button type="button" class="btn btn-outline" id="btnBackProfile">Atrás</button>
        ` : `
          <form id="formPayment" data-type="${isExtra ? "extra" : "condo"}">
            ${!isExtra ? `
              <div class="field">
                <label>Cuota a cancelar (Orden obligatorio: de la más antigua a la más reciente)</label>
                <select id="payTargetObligation" required>
                  ${ob.allPending.map((item, idx) => `
                    <option value="${item.key}" ${idx > 0 ? "disabled" : ""}>
                      ${idx === 0 ? "▶ " : "🔒 "}${item.label} — Pendiente: $${item.remainingUSD.toFixed(2)} (Bs. ${item.remainingBs.toFixed(2)})
                    </option>
                  `).join("")}
                </select>
              </div>
              <div class="alert" style="margin-bottom:12px;">
                <div><strong>Monto máximo permitido para esta cuota:</strong> $${oldest.remainingUSD.toFixed(2)} USD (<strong>Bs. ${oldest.remainingBs.toFixed(2)}</strong> a tasa Bs. ${rate.toFixed(2)}/$).</div>
                <div class="muted" style="margin-top:4px;">* Los pagos de meses anteriores se calculan a la tasa del día actual. No se permite pagar más de la deuda (sin saldo a favor).</div>
              </div>
            ` : ""}

            <div class="field">
              <label>Comprobante de pago (Capture obligatorio)</label>
              <input type="file" id="payFile" accept="image/*" required />
            </div>

            <div class="field">
              <label>Últimos 4 dígitos de la referencia (Obligatorio)</label>
              <input type="text" id="payRef" inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Ej: 4829" required />
            </div>

            <div class="field">
              <label>Monto pagado en Bolívares (Bs.)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                ${!isExtra && oldest ? `max="${(oldest.remainingBs + 1).toFixed(2)}" value="${oldest.remainingBs.toFixed(2)}"` : ""}
                id="payAmountBs"
                placeholder="Ej: 1850.00"
                required
              />
            </div>

            <div class="field">
              <label>Fecha exacta en que se realizó el pago (Por defecto hoy, modificable hacia fechas anteriores)</label>
              <input type="date" id="payDate" max="${today}" value="${today}" required />
            </div>

            <button type="submit" class="btn ${ob.hasMora && !isExtra ? "btn-mora" : "btn-accent"}" id="btnSubmitPay">Enviar pago</button>
            <button type="button" class="btn btn-outline" id="btnBackProfile">Atrás</button>
          </form>
        `}
      </div>
    `;
  }

  return `
    <!-- 1. Barra Individual del Propietario (Cambia a Rojo en Día / Naranja en Noche si está en Mora) -->
    <div class="card ${ob.hasMora ? "mora-card" : ""}">
      ${ob.hasMora ? `
        <div class="mora-banner">
          <span>⚠️ PROPIETARIO EN MORA — DEBE CANCELAR CUANTO ANTES</span>
          <span>$${ob.totalPendingUSD.toFixed(2)}</span>
        </div>
      ` : ""}

      <div class="top-banner">
        <div>
          <div class="muted">Monto Condominio Mensual (Apto ${user.apt}${ob.assignedLocals.length ? " + " + ob.assignedLocals.map(l => l.id).join(", ") : ""})</div>
          <strong>${ob.hasMora ? "Estado: En Mora (Pagos pendientes)" : `Mi Cuota del Mes (${cfg.period})`}</strong>
        </div>
        <div class="amount-badge ${ob.hasMora ? "mora" : ""}">$${ob.currentItem.totalUSD.toFixed(2)}</div>
      </div>

      <div class="progress-track">
        <div class="progress-fill ${ob.hasMora ? "mora" : ""}" style="width: ${currentPercent}%;"></div>
      </div>
      <div class="row-between muted">
        <span>Abonado mes actual: $${ob.currentItem.paidUSD.toFixed(2)} / $${ob.currentItem.totalUSD.toFixed(2)}</span>
        <span>${currentPercent}%</span>
      </div>
      <div class="muted" style="margin-top:4px;">* No se permite saldo a favor ni pagos por adelantado.</div>

      ${ob.allPending.length > 0 ? `
        <details class="mora-details" ${ob.hasMora ? "open" : ""}>
          <summary>Ver meses pendientes por pagar (${ob.allPending.length}) — Total: $${ob.totalPendingUSD.toFixed(2)}</summary>
          <div class="muted" style="margin:6px 0;">
            * Los meses anteriores son calculados con la tasa del día actual (Bs. ${rate.toFixed(2)} / $1 USD). Deben pagarse desde el más antiguo al más reciente:
          </div>
          ${ob.allPending.map((item, idx) => `
            <div class="list-item" style="margin-top:6px;">
              <div class="row-between">
                <strong>${idx + 1}. ${item.label}</strong>
                <strong style="color:var(--mora-border);">$${item.remainingUSD.toFixed(2)}</strong>
              </div>
              <div class="row-between muted" style="margin-top:3px;">
                <span>Equivalente hoy: Bs. ${item.remainingBs.toFixed(2)}</span>
                <span>${idx === 0 ? "Disponible para pagar ahora" : "Pagar cuota anterior primero"}</span>
              </div>
            </div>
          `).join("")}
        </details>
      ` : ""}
    </div>

    <!-- 2. Barra Global de los 95 Apartamentos del Edificio -->
    ${renderGlobalBuildingCard()}

    <!-- 3. Datos del Propietario y Botón de Carga -->
    <div class="card ${ob.hasMora ? "mora-card" : ""}">
      <div class="row-between" style="margin-bottom:6px;">
        <strong>${user.name}</strong>
        <span class="muted">Piso ${user.floor} • Apto ${user.apt}</span>
      </div>
      <div class="muted">${user.email} • ${user.phone}</div>

      ${state.message ? `<div class="alert" style="margin-top:10px;">${state.message}</div>` : ""}

      <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
        ${ob.oldestPayable ? `
          <button class="btn ${ob.hasMora ? "btn-mora" : "btn-primary"}" id="btnGoPayCondo">
            ${ob.hasMora ? `Pagar Cuota más Antigua (${ob.oldestPayable.period})` : "Subir Comprobante Condominio"}
          </button>
        ` : `
          <button class="btn btn-outline" disabled>Condominio al Día (Sin deuda pendiente)</button>
        `}

        ${cfg.extra_active ? `
          <button class="btn btn-secondary" id="btnGoPayExtra">Subir Comprobante Cuota Extra</button>
        ` : ""}
      </div>
    </div>

    <!-- 4. Historial de Pagos del Propietario (Con opción de Eliminar y volver a cargar) -->
    <div class="card">
      <strong style="display:block; margin-bottom:10px;">Mis Pagos Cargados</strong>
      ${myPayments.length === 0 ? `<p class="muted">Aún no has cargado comprobantes.</p>` : myPayments.map(p => `
        <div class="list-item">
          <div class="row-between">
            <strong>${p.type === "extra" ? "Cuota Extra" : `Condominio (${p.target_period || p.period})`} • Ref: ${p.ref}</strong>
            <strong>Bs. ${Number(p.amount_bs).toFixed(2)}</strong>
          </div>
          <div class="row-between muted" style="margin-top:6px;">
            <span>Fecha pago: ${p.date} ${p.amount_usd ? `($${Number(p.amount_usd).toFixed(2)})` : ""}</span>
            <div style="display:flex; align-items:center; gap:8px;">
              ${p.receipt_url ? `<a href="${p.receipt_url}" target="_blank" style="color:var(--accent); font-weight:600;">Ver Capture</a>` : ""}
              <button type="button" class="btn-danger-sm" data-delete-payment="${p.id}">Eliminar y volver a cargar</button>
            </div>
          </div>
        </div>
      `).join("")}
    </div>

    <!-- 5. Horarios del Salón de Fiesta y Pagos de Locales 1, 2 y 3 -->
    ${renderTransparencyTablesCard()}
  `;
}

// Vista: Panel del Creador (Organizado en pestañas simples)
function renderCreatorView() {
  const cfg = state.config;
  const pendingUsers = state.users.filter(u => u.status === "pending");
  const approvedUsers = state.users.filter(u => u.status === "approved");
  const { today } = getTodayInfo();

  return `
    ${renderGlobalBuildingCard()}

    <div class="card">
      <div class="tabs">
        <button class="tab-btn ${state.creatorTab === "config" ? "active" : ""}" data-ctab="config">General</button>
        <button class="tab-btn ${state.creatorTab === "mora" ? "active" : ""}" data-ctab="mora">Mora / Inicial</button>
        <button class="tab-btn ${state.creatorTab === "locales" ? "active" : ""}" data-ctab="locales">Locales y Salón</button>
        <button class="tab-btn ${state.creatorTab === "waitlist" ? "active" : ""}" data-ctab="waitlist">Espera (${pendingUsers.length})</button>
        <button class="tab-btn ${state.creatorTab === "balance" ? "active" : ""}" data-ctab="balance">Excel (${state.payments.length})</button>
      </div>

      ${state.message ? `<div class="alert">${state.message}</div>` : ""}

      <!-- PESTAÑA 1: CONFIGURACIÓN GENERAL E INGRESO ACUMULADO INICIAL -->
      ${state.creatorTab === "config" ? `
        <form id="formCreatorConfig">
          <div class="field">
            <label>Cuota Condominio Mensual por Apartamento ($ USD)</label>
            <input type="number" step="0.01" min="0" id="cfgCondoUSD" value="${cfg.condo_fee_usd}" required />
          </div>
          <div class="field">
            <label>Tasa del Día Actual (Bs. por $1 USD — Aplicada también a meses en mora)</label>
            <input type="number" step="0.01" min="0.01" id="cfgRateBs" value="${cfg.exchange_rate_bs}" required />
          </div>
          <div class="field">
            <label>Ingreso Acumulado Inicial del Edificio ($ USD en Barra Global)</label>
            <input type="number" step="0.01" min="0" id="cfgInitialUSD" value="${cfg.initial_accumulated_usd || 0}" required />
          </div>
          <div class="field" style="margin-top:8px;">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="cfgPartyActive" style="width:auto;" ${cfg.party_room_active !== false ? "checked" : ""} />
              Mostrar tabla de Salón de Fiesta a los propietarios
            </label>
          </div>
          <div class="field" style="margin-top:8px;">
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
      ` : ""}

      <!-- PESTAÑA 2: CONDICIONES INICIALES / CARGA DE MESES EN MORA POR PROPIETARIO -->
      ${state.creatorTab === "mora" ? `
        <strong style="display:block; margin-bottom:8px;">Asignar Deuda / Mes Anterior en Mora</strong>
        <form id="formAddDebt">
          <div class="field">
            <label>Apartamento (o Local)</label>
            <input type="text" id="debtApt" placeholder="Ej: 1905" required />
          </div>
          <div class="field" style="display:flex; gap:8px;">
            <div style="flex:1;">
              <label>Mes adeudado (YYYY-MM)</label>
              <input type="month" id="debtPeriod" required />
            </div>
            <div style="flex:1;">
              <label>Monto adeudado ($ USD)</label>
              <input type="number" step="0.01" min="0.01" id="debtAmountUSD" placeholder="Ej: 14.00" required />
            </div>
          </div>
          <div class="field">
            <label>Concepto</label>
            <input type="text" id="debtConcept" placeholder="Ej: Condominio Septiembre 2026" required />
          </div>
          <button type="submit" class="btn btn-secondary">Agregar Deuda al Propietario</button>
        </form>

        <div style="margin-top:16px;">
          <strong style="display:block; margin-bottom:8px;">Propietarios en Mora / Condiciones Iniciales (${state.debts.length})</strong>
          ${state.debts.length === 0 ? `<p class="muted">No hay deudas de meses anteriores registradas.</p>` : state.debts.map(d => `
            <div class="list-item">
              <div class="row-between">
                <strong>Apto ${d.apt} • ${d.period} (${d.concept})</strong>
                <strong style="color:${d.status === "paid" ? "var(--accent)" : "var(--mora-border)"};">
                  $${Number(d.paid_usd || 0).toFixed(2)} / $${Number(d.amount_usd).toFixed(2)}
                </strong>
              </div>
              <div class="row-between muted" style="margin-top:4px;">
                <span>Estado: ${d.status === "paid" ? "Pagado ✓" : "En Mora"}</span>
                <button type="button" class="btn-danger-sm" data-del-debt="${d.id}">Eliminar</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <!-- PESTAÑA 3: LOCALES 1, 2, 3 Y SALÓN DE FIESTA (7:00 AM - 11:59 PM) -->
      ${state.creatorTab === "locales" ? `
        <strong style="display:block; margin-bottom:8px;">Asignación de Locales 1, 2 y 3</strong>
        <p class="muted" style="margin-bottom:10px;">
          Si asignas un apartamento, la cuota del local se suma automáticamente al perfil de ese propietario. Si lo dejas vacío, puedes cargar su pago de forma manual abajo.
        </p>
        <form id="formSaveLocals">
          ${state.locals.map((l, idx) => `
            <div class="list-item">
              <strong>${l.id}</strong>
              <div style="display:flex; gap:8px; margin-top:6px;">
                <div style="flex:1;">
                  <label class="muted">Apto Propietario (Opcional)</label>
                  <input type="text" id="locApt_${idx}" value="${l.assigned_apt || ""}" placeholder="Ej: 1905 o vacío" />
                </div>
                <div style="flex:1;">
                  <label class="muted">Cuota Mensual ($ USD)</label>
                  <input type="number" step="0.01" min="0" id="locFee_${idx}" value="${l.monthly_fee_usd || 0}" required />
                </div>
              </div>
            </div>
          `).join("")}
          <button type="submit" class="btn btn-primary">Guardar Locales 1, 2 y 3</button>
        </form>

        <div style="margin-top:18px; padding-top:14px; border-top:1px solid var(--border);">
          <strong style="display:block; margin-bottom:8px;">Registrar Alquiler de Salón de Fiesta o Pago Manual de Local</strong>
          <form id="formSpecialIncome">
            <div class="field">
              <label>Concepto</label>
              <select id="spTitle" required>
                <option value="Salón de Fiesta">Alquiler Salón de Fiesta</option>
                <option value="Local 1">Pago Manual - Local 1</option>
                <option value="Local 2">Pago Manual - Local 2</option>
                <option value="Local 3">Pago Manual - Local 3</option>
              </select>
            </div>

            <div id="salonScheduleFields">
              <div class="field">
                <label>Día de la semana (Domingo a Sábado)</label>
                <select id="spDay">
                  <option value="Domingo">Domingo</option>
                  <option value="Lunes">Lunes</option>
                  <option value="Martes">Martes</option>
                  <option value="Miércoles">Miércoles</option>
                  <option value="Jueves">Jueves</option>
                  <option value="Viernes">Viernes</option>
                  <option value="Sábado">Sábado</option>
                </select>
              </div>
              <div class="field" style="display:flex; gap:8px;">
                <div style="flex:1;">
                  <label>Hora Inicio (07:00 a 23:59)</label>
                  <input type="time" id="spStart" min="07:00" max="23:59" value="09:00" />
                </div>
                <div style="flex:1;">
                  <label>Hora Fin (07:00 a 23:59)</label>
                  <input type="time" id="spEnd" min="07:00" max="23:59" value="22:00" />
                </div>
              </div>
            </div>

            <div class="field" style="display:flex; gap:8px;">
              <div style="flex:1;">
                <label>Monto ($ USD)</label>
                <input type="number" step="0.01" min="0.01" id="spAmountUSD" placeholder="Ej: 50.00" required />
              </div>
              <div style="flex:1;">
                <label>Fecha</label>
                <input type="date" id="spDate" value="${today}" required />
              </div>
            </div>

            <div class="field">
              <label>Modalidad de Pago</label>
              <select id="spMethod">
                <option value="cash_usd">Pago en Dólares en Efectivo ($ USD)</option>
                <option value="transfer_bs">Transferencia / Pago Móvil (Con Capture)</option>
              </select>
            </div>

            <div id="spTransferFields" style="display:none;">
              <div class="field">
                <label>Últimos 4 dígitos de Referencia</label>
                <input type="text" id="spRef" maxlength="4" placeholder="Ej: 9182" />
              </div>
              <div class="field">
                <label>Comprobante de Pago (Capture)</label>
                <input type="file" id="spFile" accept="image/*" />
              </div>
            </div>

            <button type="submit" class="btn btn-accent" id="btnSaveSpecial">Guardar Registro</button>
          </form>

          <div style="margin-top:14px;">
            <strong style="display:block; margin-bottom:8px;">Registros de Salón y Locales (${state.specialIncomes.length})</strong>
            ${state.specialIncomes.map(s => `
              <div class="list-item">
                <div class="row-between">
                  <strong>${s.title} ${s.category === "salon" ? `(${s.day_of_week} ${s.start_time}-${s.end_time})` : ""}</strong>
                  <strong>$${Number(s.amount_usd).toFixed(2)}</strong>
                </div>
                <div class="row-between muted" style="margin-top:4px;">
                  <span>${s.date} • ${s.payment_method === "cash_usd" ? "Efectivo $" : `Ref: ${s.ref}`}</span>
                  <button type="button" class="btn-danger-sm" data-del-special="${s.id}">Eliminar</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- PESTAÑA 4: LISTA DE ESPERA Y PROPIETARIOS VERIFICADOS -->
      ${state.creatorTab === "waitlist" ? `
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

        <div style="margin-top:16px;">
          <strong style="display:block; margin-bottom:8px;">Propietarios Verificados (${approvedUsers.length})</strong>
          ${approvedUsers.map(u => `
            <div class="list-item">
              <div class="row-between">
                <strong>Apto ${u.apt} (Piso ${u.floor})</strong>
                <span>${u.name}</span>
              </div>
              <div class="muted">${u.phone} • ${u.email}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <!-- PESTAÑA 5: BALANCE Y EXPORTACIÓN A EXCEL -->
      ${state.creatorTab === "balance" ? `
        <button class="btn btn-accent" id="btnExportExcel">Exportar Balance a Excel (.CSV)</button>
        <div style="margin-top:12px;">
          ${state.payments.length === 0 ? `<p class="muted">No se han registrado pagos todavía.</p>` : state.payments.map(p => `
            <div class="list-item">
              <div class="row-between">
                <strong>Apto ${p.apt} • ${p.owner_name}</strong>
                <strong>Bs. ${Number(p.amount_bs).toFixed(2)}</strong>
              </div>
              <div class="row-between muted" style="margin-top:4px;">
                <span>Ref: ${p.ref} (${p.type === "extra" ? "Cuota Extra" : `Condominio ${p.target_period || p.period}`})</span>
                <span>${p.date} ${p.receipt_url ? `• <a href="${p.receipt_url}" target="_blank" style="color:var(--accent);">Capture</a>` : ""}</span>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>

    ${renderTransparencyTablesCard()}
  `;
}

// Eventos en Lista de Espera
function bindWaitingEvents() {
  const btn = document.getElementById("btnCheckApproval");
  if (btn) {
    btn.onclick = async () => {
      btn.textContent = "Verificando...";
      await syncFromDatabase();
    };
  }
}

// Eventos de Autenticación
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
        state.message = `Ya existe un perfil para el apartamento ${apt}. No se permiten perfiles duplicados.`;
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
        state.message = "No se pudo completar el registro.";
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

// Eventos del Propietario (Pago FIFO sin saldo a favor + Eliminación de pagos erróneos)
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

  // Eliminar un pago cargado por error y restaurar saldo pendiente
  document.querySelectorAll("[data-delete-payment]").forEach(btn => {
    btn.onclick = async () => {
      const payId = Number(btn.getAttribute("data-delete-payment"));
      const payment = state.payments.find(p => p.id === payId);
      if (!payment) return;

      const confirmDelete = confirm(`¿Eliminar el pago Ref: ${payment.ref} por Bs. ${Number(payment.amount_bs).toFixed(2)} para volver a cargarlo?`);
      if (!confirmDelete) return;

      // Si el pago estaba asociado a una deuda en mora, restar el monto abonado de esa deuda
      if (payment.debt_id) {
        const debt = state.debts.find(d => d.id === Number(payment.debt_id));
        if (debt) {
          const newPaidUSD = Math.max(0, Number(debt.paid_usd || 0) - Number(payment.amount_usd || 0));
          await db.from("debts").update({
            paid_usd: newPaidUSD,
            status: newPaidUSD >= Number(debt.amount_usd) - 0.02 ? "paid" : "pending"
          }).eq("id", debt.id);
        }
      }

      await db.from("payments").delete().eq("id", payId);
      state.message = "Pago eliminado. Puedes volver a cargarlo con los datos corregidos.";
      await syncFromDatabase();
    };
  });

  const formPayment = document.getElementById("formPayment");
  if (formPayment) {
    formPayment.onsubmit = async (e) => {
      e.preventDefault();
      const type = formPayment.getAttribute("data-type");
      const fileInput = document.getElementById("payFile");
      const ref = document.getElementById("payRef").value.trim();
      const amountBs = parseFloat(document.getElementById("payAmountBs").value);
      const date = document.getElementById("payDate").value;
      const { today, period } = getTodayInfo();
      const rate = Number(state.config.exchange_rate_bs) > 0 ? Number(state.config.exchange_rate_bs) : 1;

      if (!fileInput.files || fileInput.files.length === 0) {
        state.message = "Es obligatorio adjuntar la imagen del comprobante.";
        render();
        return;
      }

      if (!/^\d{4}$/.test(ref)) {
        state.message = "Es obligatorio colocar los últimos 4 dígitos numéricos de la referencia.";
        render();
        return;
      }

      if (!date || date > today) {
        state.message = "La fecha de pago no puede ser posterior al día de hoy.";
        render();
        return;
      }

      const amountUSD = Number((amountBs / rate).toFixed(4));
      let targetPeriod = period;
      let debtId = null;

      // Validación estricta FIFO y prohibición de Saldo a Favor para Condominio
      if (type === "condo") {
        const ob = getOwnerObligations(user.apt);
        const oldest = ob.oldestPayable;

        if (!oldest) {
          state.message = "No tienes deuda pendiente. No se permite saldo a favor ni pagos por adelantado.";
          render();
          return;
        }

        // Margen de tolerancia de $0.05 por decimales de conversión Bs/$
        if (amountUSD > oldest.remainingUSD + 0.05) {
          state.message = `No puedes tener saldo a favor. Tu monto máximo a cancelar para "${oldest.label}" es $${oldest.remainingUSD.toFixed(2)} (Bs. ${oldest.remainingBs.toFixed(2)}).`;
          render();
          return;
        }

        targetPeriod = oldest.period;
        debtId = oldest.debtId;
      }

      const btn = document.getElementById("btnSubmitPay");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Subiendo comprobante...";
      }

      const file = fileInput.files[0];
      const ext = file.name.split(".").pop();
      const filePath = `${period}/apto_${user.apt}_${Date.now()}.${ext}`;

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
        amount_usd: amountUSD,
        date,
        period,
        target_period: targetPeriod,
        debt_id: debtId,
        receipt_url: receiptUrl
      }]);

      if (insertErr) {
        state.message = "Error al guardar el pago. Verifica que ejecutaste el nuevo SQL en Supabase.";
        render();
        return;
      }

      // Si pagó una deuda en mora, actualizar el progreso de esa deuda
      if (debtId) {
        const debt = state.debts.find(d => d.id === Number(debtId));
        if (debt) {
          const updatedPaid = Number((Number(debt.paid_usd || 0) + amountUSD).toFixed(2));
          const isNowPaid = updatedPaid >= Number(debt.amount_usd) - 0.05;
          await db.from("debts").update({
            paid_usd: Math.min(Number(debt.amount_usd), updatedPaid),
            status: isNowPaid ? "paid" : "pending"
          }).eq("id", debt.id);
        }
      }

      state.ownerView = "profile";
      state.message = "Pago registrado correctamente.";
      await syncFromDatabase();
    };
  }
}

// Eventos del Creador
function bindCreatorEvents() {
  document.querySelectorAll("[data-ctab]").forEach(btn => {
    btn.onclick = () => {
      state.creatorTab = btn.getAttribute("data-ctab");
      state.message = "";
      render();
    };
  });

  // 1. Guardar configuración general e ingreso acumulado inicial
  const formCreatorConfig = document.getElementById("formCreatorConfig");
  if (formCreatorConfig) {
    formCreatorConfig.onsubmit = async (e) => {
      e.preventDefault();
      const condo_fee_usd = parseFloat(document.getElementById("cfgCondoUSD").value) || 0;
      const exchange_rate_bs = parseFloat(document.getElementById("cfgRateBs").value) || 1;
      const initial_accumulated_usd = parseFloat(document.getElementById("cfgInitialUSD").value) || 0;
      const party_room_active = document.getElementById("cfgPartyActive").checked;
      const extra_active = document.getElementById("cfgExtraActive").checked;
      const extra_limit_usd = parseFloat(document.getElementById("cfgExtraUSD").value) || 0;

      const { error } = await db.from("config").update({
        condo_fee_usd,
        exchange_rate_bs,
        initial_accumulated_usd,
        party_room_active,
        extra_active,
        extra_limit_usd
      }).eq("id", 1);

      state.message = error ? "Error al guardar configuración." : "Configuración y saldo acumulado actualizados.";
      await syncFromDatabase();
    };
  }

  // 2. Agregar deuda / condición inicial en mora a un propietario
  const formAddDebt = document.getElementById("formAddDebt");
  if (formAddDebt) {
    formAddDebt.onsubmit = async (e) => {
      e.preventDefault();
      const apt = document.getElementById("debtApt").value.trim().toUpperCase();
      const period = document.getElementById("debtPeriod").value.trim();
      const amount_usd = parseFloat(document.getElementById("debtAmountUSD").value) || 0;
      const concept = document.getElementById("debtConcept").value.trim();

      const { error } = await db.from("debts").insert([{
        apt,
        period,
        concept,
        amount_usd,
        paid_usd: 0,
        status: "pending"
      }]);

      state.message = error ? "Error al agregar deuda." : `Deuda de ${period} asignada al apartamento ${apt}.`;
      await syncFromDatabase();
    };
  }

  document.querySelectorAll("[data-del-debt]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del-debt"));
      await db.from("debts").delete().eq("id", id);
      state.message = "Deuda eliminada.";
      await syncFromDatabase();
    };
  });

  // 3. Guardar asignación de Locales 1, 2 y 3
  const formSaveLocals = document.getElementById("formSaveLocals");
  if (formSaveLocals) {
    formSaveLocals.onsubmit = async (e) => {
      e.preventDefault();
      for (let i = 0; i < state.locals.length; i++) {
        const localId = state.locals[i].id;
        const assigned_apt = document.getElementById(`locApt_${i}`).value.trim().toUpperCase();
        const monthly_fee_usd = parseFloat(document.getElementById(`locFee_${i}`).value) || 0;
        await db.from("locals").upsert({
          id: localId,
          assigned_apt,
          monthly_fee_usd
        });
      }
      state.message = "Locales 1, 2 y 3 actualizados.";
      await syncFromDatabase();
    };
  }

  // Mostrar/ocultar campos según Salón o Local y según Efectivo o Capture
  const spTitle = document.getElementById("spTitle");
  const salonScheduleFields = document.getElementById("salonScheduleFields");
  if (spTitle && salonScheduleFields) {
    spTitle.onchange = () => {
      salonScheduleFields.style.display = spTitle.value === "Salón de Fiesta" ? "block" : "none";
    };
  }

  const spMethod = document.getElementById("spMethod");
  const spTransferFields = document.getElementById("spTransferFields");
  if (spMethod && spTransferFields) {
    spMethod.onchange = () => {
      spTransferFields.style.display = spMethod.value === "transfer_bs" ? "block" : "none";
    };
  }

  // Registrar alquiler de Salón de Fiesta o pago manual de Local
  const formSpecialIncome = document.getElementById("formSpecialIncome");
  if (formSpecialIncome) {
    formSpecialIncome.onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById("spTitle").value;
      const category = title === "Salón de Fiesta" ? "salon" : "local";
      const day_of_week = category === "salon" ? document.getElementById("spDay").value : "";
      const start_time = category === "salon" ? document.getElementById("spStart").value : "";
      const end_time = category === "salon" ? document.getElementById("spEnd").value : "";
      const amount_usd = parseFloat(document.getElementById("spAmountUSD").value) || 0;
      const date = document.getElementById("spDate").value;
      const payment_method = document.getElementById("spMethod").value;
      const ref = document.getElementById("spRef") ? document.getElementById("spRef").value.trim() : "";
      const fileInput = document.getElementById("spFile");
      const { period } = getTodayInfo();

      if (category === "salon") {
        if (start_time < "07:00" || end_time > "23:59" || start_time >= end_time) {
          state.message = "El horario del Salón de Fiesta debe estar entre 07:00 AM y 11:59 PM.";
          render();
          return;
        }
      }

      let receipt_url = "";
      if (payment_method === "transfer_bs") {
        if (!/^\d{4}$/.test(ref)) {
          state.message = "Indica los últimos 4 dígitos de la referencia.";
          render();
          return;
        }
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const ext = file.name.split(".").pop();
          const filePath = `${period}/especial_${Date.now()}.${ext}`;
          const { error: upErr } = await db.storage.from("captures").upload(filePath, file);
          if (!upErr) {
            const { data: pubUrl } = db.storage.from("captures").getPublicUrl(filePath);
            receipt_url = pubUrl?.publicUrl || "";
          }
        }
      }

      const { error } = await db.from("special_incomes").insert([{
        category,
        title,
        day_of_week,
        start_time,
        end_time,
        amount_usd,
        payment_method,
        ref: payment_method === "cash_usd" ? "EFECTIVO" : ref,
        receipt_url,
        date,
        period
      }]);

      state.message = error ? "Error al guardar el registro." : `${title} registrado y sumado al fondo global.`;
      await syncFromDatabase();
    };
  }

  document.querySelectorAll("[data-del-special]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.getAttribute("data-del-special"));
      await db.from("special_incomes").delete().eq("id", id);
      state.message = "Registro eliminado.";
      await syncFromDatabase();
    };
  });

  // 4. Aprobar / Rechazar Lista de Espera
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

  // 5. Exportar Balance a Excel (.CSV)
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
        const ownerInfo = `${p.owner_name} - Piso ${p.floor} Apto ${p.apt} (${p.owner_phone} / ${p.owner_email}) [${p.target_period || p.period}]`;
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
      a.download = `Balance_Condominio_Macanillal_${getTodayInfo().period}.csv`;
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

  db.channel("macanillal-realtime-v3")
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
