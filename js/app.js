// js/app.js — Dashboard page logic (complete rewrite)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtCurrency, fmtDate, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;
let dashPeriod = 'today'; // today | week | month | custom

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
    d.setDate(d.getDate() - d.getDay()); // Sunday
    return { start: fmtDateISO(d), end: todayISO };
  }
  if (dashPeriod === 'month') {
    return { start: todayISO.slice(0, 8) + '01', end: todayISO };
  }
  // custom
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

    // Parallel queries
    const [
      { count: patientCount },
      { data: periodAppts },
      { data: periodPayments },
    ] = await Promise.all([
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('appointments')
        .select('id, status, value, professional_id, professionals(name)')
        .gte('appointment_date', start).lte('appointment_date', end),
      supabase.from('payments')
        .select('final_amount, payment_status, appointment_id')
        .gte('paid_at', start + 'T00:00:00').lte('paid_at', end + 'T23:59:59'),
    ]);

    const appts = periodAppts || [];
    const pays = periodPayments || [];

    // Status counts
    const statusCounts = {};
    ['Agendado','Paciente na recepção','Em atendimento','Finalizado','Faltou','Cancelado','Reagendado']
      .forEach(s => statusCounts[s] = 0);
    appts.forEach(a => { statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

    const totalAppts = appts.length;
    const waitingCount = statusCounts['Paciente na recepção'];

    // Financial
    const totalPaid = pays.filter(p => p.payment_status === 'Pago').reduce((s, p) => s + (p.final_amount || 0), 0);
    const totalExpected = appts.reduce((s, a) => s + (a.value || 0), 0);
    const totalPending = totalExpected - totalPaid;
    const paidCount = pays.filter(p => p.payment_status === 'Pago').length;

    // Period filter HTML
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

    // Financial cards (admin + recepcionista)
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
            <div><div class="stat-label">A receber</div><div class="stat-value">${fmtCurrency(Math.max(0, totalPending))}</div></div>
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
    const statusRows = Object.entries(statusCounts)
      .map(([name, count]) => `
        <div class="status-bar-item">
          <span class="status-bar-label">${name}</span>
          <div class="status-bar-track">
            <div class="status-bar-fill" style="width:${totalAppts ? (count/totalAppts*100) : 0}%;background:${statusColors[name]}"></div>
          </div>
          <span class="status-bar-count">${count}</span>
        </div>
      `).join('');

    // Main content
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
          <div><div class="stat-label">Pacientes Cadastrados</div><div class="stat-value">${patientCount || 0}</div></div>
        </div>
        <div class="stat c-green">
          <div class="stat-icon green">${Icons.check}</div>
          <div><div class="stat-label">Finalizados</div><div class="stat-value">${statusCounts['Finalizado']}</div></div>
        </div>
      </div>

      ${financialHTML}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px">
        <div class="card">
          <div class="card-head"><h3>Agendamentos por Status</h3></div>
          <div class="card-body" style="padding:18px">
            ${totalAppts ? statusRows : '<div class="empty"><p>Sem agendamentos no período</p></div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Resumo do Período</h3></div>
          <div class="card-body" style="padding:18px">
            <div class="status-bar-item"><span class="status-bar-label">Faltas</span><span class="status-bar-count" style="color:var(--danger)">${statusCounts['Faltou']}</span></div>
            <div class="status-bar-item"><span class="status-bar-label">Cancelamentos</span><span class="status-bar-count" style="color:var(--t3)">${statusCounts['Cancelado']}</span></div>
            <div class="status-bar-item"><span class="status-bar-label">Reagendados</span><span class="status-bar-count" style="color:var(--info)">${statusCounts['Reagendado']}</span></div>
            <div class="status-bar-item" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><span class="status-bar-label"><strong>Total geral</strong></span><span class="status-bar-count"><strong>${totalAppts}</strong></span></div>
          </div>
        </div>
      </div>

      ${can(role, 'financial_charts') ? buildChartsSection() : ''}
    `;

    // Period tab events
    content.querySelectorAll('[data-period]').forEach(tab => {
      tab.addEventListener('click', () => {
        dashPeriod = tab.dataset.period;
        loadDashboard();
      });
    });

    // Custom date apply
    const applyBtn = document.getElementById('dash-apply');
    if (applyBtn) applyBtn.addEventListener('click', () => loadDashboard());

    // Charts
    if (can(role, 'financial_charts')) await loadCharts();

  } catch (err) {
    console.error(err);
    content.innerHTML = '<div class="empty"><p>Erro ao carregar o dashboard.</p></div>';
    toast('Erro ao carregar o dashboard', 'err');
  }
}

function buildChartsSection() {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px" id="charts-grid">
      <div class="card">
        <div class="card-head"><h3>Entradas por Dia</h3></div>
        <div class="card-body"><div class="chart-area"><div class="bar-chart" id="chart-daily"></div></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Entradas por Mês</h3></div>
        <div class="card-body"><div class="chart-area"><div class="bar-chart" id="chart-monthly"></div></div></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Entrada por Procedimento</h3></div>
      <div class="card-body"><div class="chart-area"><div class="donut-wrap" id="chart-procedures"></div></div></div>
    </div>
  `;
}

async function loadCharts() {
  try {
    const { data: pays } = await supabase
      .from('payments')
      .select('final_amount, paid_at, appointment_id, appointments(procedure_id, procedures_catalog(name))')
      .eq('payment_status', 'Pago');

    const procs = (pays || []).map(p => ({
      date: p.paid_at?.split('T')[0],
      value: p.final_amount || 0,
      name: p.appointments?.procedures_catalog?.name || 'Outros',
    }));

    renderDailyChart(procs);
    renderMonthlyChart(procs);
    renderProcedureChart(procs);
  } catch (err) {
    console.error('Charts error:', err);
  }
}

function renderDailyChart(procs) {
  const container = document.getElementById('chart-daily');
  if (!container) return;
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = fmtDateISO(d);
    const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const total = procs.filter(p => p.date === key).reduce((s, p) => s + p.value, 0);
    days.push({ label, total });
  }
  const max = Math.max(...days.map(d => d.total), 1);
  container.innerHTML = days.map(d => `
    <div class="bar-group"><div class="bar-wrap"><div class="bar" style="height:0%" data-h="${(d.total/max*100)}" title="${fmtCurrency(d.total)}"></div></div><span class="bar-lbl">${d.label}</span></div>
  `).join('');
  requestAnimationFrame(() => setTimeout(() => container.querySelectorAll('.bar').forEach(b => b.style.height = b.dataset.h + '%'), 100));
}

function renderMonthlyChart(procs) {
  const container = document.getElementById('chart-monthly');
  if (!container) return;
  const months = {};
  const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  procs.forEach(p => { const m = p.date?.slice(0, 7); if (m) months[m] = (months[m] || 0) + p.value; });
  const today = new Date();
  const entries = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = fmtDateISO(d).slice(0, 7);
    entries.push({ label: monthNames[d.getMonth()], total: months[key] || 0 });
  }
  const max = Math.max(...entries.map(e => e.total), 1);
  container.innerHTML = entries.map(e => `
    <div class="bar-group"><div class="bar-wrap"><div class="bar" style="height:0%" data-h="${(e.total/max*100)}" title="${fmtCurrency(e.total)}"></div></div><span class="bar-lbl">${e.label}</span></div>
  `).join('');
  requestAnimationFrame(() => setTimeout(() => container.querySelectorAll('.bar').forEach(b => b.style.height = b.dataset.h + '%'), 150));
}

function renderProcedureChart(procs) {
  const container = document.getElementById('chart-procedures');
  if (!container) return;
  const groups = {};
  procs.forEach(p => { groups[p.name] = (groups[p.name] || 0) + p.value; });
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ['#2cd299','#6c63ff','#3b82f6','#f59e0b','#ef4444','#8b8fa3'];
  const r = 60, circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = sorted.map(([, val], i) => {
    const len = (val / total) * circ;
    const seg = `<circle class="donut-seg" cx="90" cy="90" r="${r}" stroke="${colors[i]}" stroke-dasharray="${len} ${circ-len}" stroke-dashoffset="${-offset}"/>`;
    offset += len; return seg;
  }).join('');
  const legend = sorted.map(([name, val], i) => `
    <div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span><span>${name}</span><span class="legend-val">${fmtCurrency(val)}</span></div>
  `).join('');
  container.innerHTML = `
    <svg class="donut-svg" viewBox="0 0 180 180"><circle cx="90" cy="90" r="${r}" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="26"/>${segs}</svg>
    <div class="legend">${legend}</div>
  `;
}

init();
