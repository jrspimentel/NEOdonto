// js/app.js — Dashboard page logic (robust error handling)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtCurrency, fmtDate, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;
let dashPeriod = 'today';

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const role = currentUser.profile.role;
  if (!can(role, 'dashboard')) {
    window.location.href = 'pages/agenda.html';
    return;
  }

  initLayout(currentUser, 'dashboard');
  document.getElementById('greeting').textContent = `Seja bem-vindo, ${currentUser.profile.name}!`;
  await loadDashboard();
}

function getDateRange() {
  const today = new Date();
  const todayISO = fmtDateISO(today);

  if (dashPeriod === 'today') return { start: todayISO, end: todayISO };
  if (dashPeriod === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay());
    return { start: fmtDateISO(d), end: todayISO };
  }
  if (dashPeriod === 'month') {
    return { start: todayISO.slice(0, 8) + '01', end: todayISO };
  }
  const s = document.getElementById('dash-date-start')?.value || todayISO;
  const e = document.getElementById('dash-date-end')?.value || todayISO;
  return { start: s, end: e };
}

async function loadDashboard() {
  const role = currentUser.profile.role;
  const content = document.getElementById('dash-content');
  showLoader(content);

  try {
    const { start, end } = getDateRange();

    // Individual queries with error handling
    let patientCount = 0;
    let appts = [];
    let pays = [];

    try {
      const res = await supabase.from('patients').select('*', { count: 'exact', head: true });
      patientCount = res.count || 0;
    } catch (e) { console.warn('patients query failed:', e); }

    try {
      const res = await supabase.from('appointments')
        .select('id, status, value, professional_id, professionals(name)')
        .gte('appointment_date', start).lte('appointment_date', end);
      appts = res.data || [];
    } catch (e) { console.warn('appointments query failed:', e); }

    try {
      const res = await supabase.from('payments')
        .select('final_amount, payment_status, appointment_id')
        .gte('created_at', start + 'T00:00:00')
        .lte('created_at', end + 'T23:59:59');
      pays = res.data || [];
    } catch (e) { console.warn('payments query failed:', e); }

    // Status counts
    const statusCounts = {};
    ['Agendado','Paciente na recepção','Em atendimento','Finalizado','Faltou','Cancelado','Reagendado']
      .forEach(s => statusCounts[s] = 0);
    appts.forEach(a => { if (a.status) statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

    const totalAppts = appts.length;
    const waitingCount = statusCounts['Paciente na recepção'] || 0;

    // Financial
    const totalPaid = pays.filter(p => p.payment_status === 'Pago').reduce((s, p) => s + (p.final_amount || 0), 0);
    const totalExpected = appts.reduce((s, a) => s + (a.value || 0), 0);
    const totalPending = Math.max(0, totalExpected - totalPaid);
    const paidCount = pays.filter(p => p.payment_status === 'Pago').length;

    // Period filter
    const periodHTML = `
      <div class="dash-period">
        <div class="tabs" style="margin-bottom:0">
          <button class="tab ${dashPeriod === 'today' ? 'active' : ''}" data-period="today">Hoje</button>
          <button class="tab ${dashPeriod === 'week' ? 'active' : ''}" data-period="week">Esta semana</button>
          <button class="tab ${dashPeriod === 'month' ? 'active' : ''}" data-period="month">Este mês</button>
          <button class="tab ${dashPeriod === 'custom' ? 'active' : ''}" data-period="custom">Personalizado</button>
        </div>
        ${dashPeriod === 'custom' ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
            <input type="date" id="dash-date-start" class="input-date" value="${start}"/>
            <span style="color:var(--t3);font-size:.85rem">até</span>
            <input type="date" id="dash-date-end" class="input-date" value="${end}"/>
            <button class="btn btn-p btn-sm" id="dash-apply">${Icons.filter} Filtrar</button>
          </div>
        ` : ''}
      </div>
    `;

    // Financial cards
    let financialHTML = '';
    if (can(role, 'financial_indicators')) {
      financialHTML = `
        <div class="stats-row">
          <div class="stat c-green">
            <div class="stat-icon green">${Icons.money}</div>
            <div><div class="stat-label">Faturamento</div><div class="stat-value">${fmtCurrency(totalPaid)}</div></div>
          </div>
          <div class="stat c-orange">
            <div class="stat-icon orange">${Icons.money}</div>
            <div><div class="stat-label">A receber</div><div class="stat-value">${fmtCurrency(totalPending)}</div></div>
          </div>
          <div class="stat c-blue">
            <div class="stat-icon blue">${Icons.check}</div>
            <div><div class="stat-label">Procedimentos pagos</div><div class="stat-value">${paidCount}</div></div>
          </div>
        </div>
      `;
    }

    // Status distribution
    const statusColors = {
      'Agendado': '#3b82f6', 'Paciente na recepção': '#f59e0b', 'Em atendimento': '#8b5cf6',
      'Finalizado': '#22c55e', 'Faltou': '#ef4444', 'Cancelado': '#6b7280', 'Reagendado': '#06b6d4',
    };
    const statusRows = Object.entries(statusCounts).map(([name, count]) => `
      <div class="status-bar-item">
        <span class="status-bar-label">${name}</span>
        <div class="status-bar-track">
          <div class="status-bar-fill" style="width:${totalAppts ? (count/totalAppts*100) : 0}%;background:${statusColors[name] || '#666'}"></div>
        </div>
        <span class="status-bar-count">${count}</span>
      </div>
    `).join('');

    content.innerHTML = `
      ${periodHTML}
      <div class="stats-row" style="margin-top:18px">
        <div class="stat c-purple">
          <div class="stat-icon purple">${Icons.calendar}</div>
          <div><div class="stat-label">Agendamentos</div><div class="stat-value">${totalAppts}</div></div>
        </div>
        <div class="stat c-orange">
          <div class="stat-icon orange">${Icons.waiting}</div>
          <div><div class="stat-label">Na Recepção</div><div class="stat-value">${waitingCount}</div></div>
        </div>
        <div class="stat">
          <div class="stat-icon blue">${Icons.patients}</div>
          <div><div class="stat-label">Pacientes Cadastrados</div><div class="stat-value">${patientCount}</div></div>
        </div>
        <div class="stat c-green">
          <div class="stat-icon green">${Icons.check}</div>
          <div><div class="stat-label">Finalizados</div><div class="stat-value">${statusCounts['Finalizado'] || 0}</div></div>
        </div>
      </div>
      ${financialHTML}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px">
        <div class="card">
          <div class="card-head"><h3>Agendamentos por Status</h3></div>
          <div class="card-body">${totalAppts ? statusRows : '<div class="empty"><p>Sem agendamentos no período</p></div>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Resumo do Período</h3></div>
          <div class="card-body">
            <div class="status-bar-item"><span class="status-bar-label">Faltas</span><span class="status-bar-count" style="color:var(--danger)">${statusCounts['Faltou'] || 0}</span></div>
            <div class="status-bar-item"><span class="status-bar-label">Cancelamentos</span><span class="status-bar-count" style="color:var(--t3)">${statusCounts['Cancelado'] || 0}</span></div>
            <div class="status-bar-item"><span class="status-bar-label">Reagendados</span><span class="status-bar-count" style="color:var(--info)">${statusCounts['Reagendado'] || 0}</span></div>
            <div class="status-bar-item" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><span class="status-bar-label"><strong>Total geral</strong></span><span class="status-bar-count"><strong>${totalAppts}</strong></span></div>
          </div>
        </div>
      </div>
    `;

    // Period tab events
    content.querySelectorAll('[data-period]').forEach(tab => {
      tab.addEventListener('click', () => { dashPeriod = tab.dataset.period; loadDashboard(); });
    });
    const applyBtn = document.getElementById('dash-apply');
    if (applyBtn) applyBtn.addEventListener('click', () => loadDashboard());

  } catch (err) {
    console.error('Dashboard error:', err);
    content.innerHTML = '<div class="empty"><p>Erro ao carregar dashboard. Verifique o console para mais detalhes.</p></div>';
    toast('Erro ao carregar o dashboard', 'err');
  }
}

init();
