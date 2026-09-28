// js/app.js — Dashboard page logic
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtCurrency, fmtDate, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const role = currentUser.profile.role;

  // Redirect auxiliar — no dashboard access
  if (!can(role, 'dashboard')) {
    window.location.href = 'pages/agenda.html';
    return;
  }

  initLayout(currentUser, 'dashboard');

  // Greeting
  document.getElementById('greeting').textContent = `Seja bem-vindo, ${currentUser.profile.name}!`;

  await loadDashboard();
}

async function loadDashboard() {
  const role = currentUser.profile.role;
  const content = document.getElementById('dash-content');
  showLoader(content);

  try {
    // Load operational stats (all dashboard users)
    const today = fmtDateISO(new Date());
    const monthStart = today.slice(0, 8) + '01';

    // Today's appointments
    const { count: todayCount } = await supabase
      .from('procedures')
      .select('*', { count: 'exact', head: true })
      .eq('date', today);

    // Month appointments
    const { count: monthCount } = await supabase
      .from('procedures')
      .select('*', { count: 'exact', head: true })
      .gte('date', monthStart)
      .lte('date', today);

    // Active patients
    const { count: patientCount } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });

    // Waiting room count
    const { count: waitingCount } = await supabase
      .from('procedures')
      .select('*', { count: 'exact', head: true })
      .eq('date', today)
      .eq('situation', 'Paciente na recepção');

    let financialHTML = '';
    let chartsHTML = '';

    // Financial indicators — admin only
    if (can(role, 'financial_indicators')) {
      // Today revenue
      const { data: todayProcs } = await supabase
        .from('procedures')
        .select('value')
        .eq('date', today)
        .eq('paid', true);
      const todayRevenue = (todayProcs || []).reduce((s, p) => s + (p.value || 0), 0);

      // Month revenue
      const { data: monthProcs } = await supabase
        .from('procedures')
        .select('value')
        .gte('date', monthStart)
        .lte('date', today)
        .eq('paid', true);
      const monthRevenue = (monthProcs || []).reduce((s, p) => s + (p.value || 0), 0);

      financialHTML = `
        <div class="stat c-green">
          <div class="stat-icon green">${Icons.money}</div>
          <div>
            <div class="stat-label">Entrada do Dia</div>
            <div class="stat-value">${fmtCurrency(todayRevenue)}</div>
          </div>
        </div>
        <div class="stat c-blue">
          <div class="stat-icon blue">${Icons.money}</div>
          <div>
            <div class="stat-label">Entrada do Mês</div>
            <div class="stat-value">${fmtCurrency(monthRevenue)}</div>
          </div>
        </div>
      `;

      // Charts
      chartsHTML = buildChartsSection();
    }

    content.innerHTML = `
      <div class="stats-row">
        ${financialHTML}
        <div class="stat c-purple">
          <div class="stat-icon purple">${Icons.calendar}</div>
          <div>
            <div class="stat-label">Atendimentos Hoje</div>
            <div class="stat-value">${todayCount || 0}</div>
          </div>
        </div>
        <div class="stat c-orange">
          <div class="stat-icon orange">${Icons.waiting}</div>
          <div>
            <div class="stat-label">Na Recepção</div>
            <div class="stat-value">${waitingCount || 0}</div>
          </div>
        </div>
      </div>

      ${can(role, 'financial_indicators') ? `
      <div class="stats-row">
        <div class="stat">
          <div class="stat-icon blue">${Icons.patients}</div>
          <div>
            <div class="stat-label">Pacientes Cadastrados</div>
            <div class="stat-value">${patientCount || 0}</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat-icon purple">${Icons.calendar}</div>
          <div>
            <div class="stat-label">Atendimentos no Mês</div>
            <div class="stat-value">${monthCount || 0}</div>
          </div>
        </div>
      </div>
      ` : `
      <div class="stats-row">
        <div class="stat">
          <div class="stat-icon blue">${Icons.patients}</div>
          <div>
            <div class="stat-label">Pacientes Cadastrados</div>
            <div class="stat-value">${patientCount || 0}</div>
          </div>
        </div>
        <div class="stat">
          <div class="stat-icon purple">${Icons.calendar}</div>
          <div>
            <div class="stat-label">Atendimentos no Mês</div>
            <div class="stat-value">${monthCount || 0}</div>
          </div>
        </div>
      </div>
      `}

      ${chartsHTML}
    `;

    // If admin, load charts data
    if (can(role, 'financial_charts')) {
      await loadCharts();
    }

  } catch (err) {
    console.error(err);
    content.innerHTML = '<div class="empty"><p>Erro ao carregar o dashboard.</p></div>';
    toast('Erro ao carregar o dashboard', 'err');
  }
}

function buildChartsSection() {
  return `
    <!-- Filter -->
    <div class="dash-filter" id="dash-filter">
      <div class="form-group">
        <label>Data Inicial</label>
        <input type="date" id="filter-start" />
      </div>
      <div class="form-group">
        <label>Data Final</label>
        <input type="date" id="filter-end" />
      </div>
      <button class="btn btn-p btn-sm" id="btn-filter">${Icons.filter} Filtrar</button>
      <button class="btn btn-s btn-sm" id="btn-clear">Limpar</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px" id="charts-grid">
      <!-- Entradas por dia -->
      <div class="card">
        <div class="card-head"><h3>Entradas por Dia</h3></div>
        <div class="card-body">
          <div class="chart-area"><div class="bar-chart" id="chart-daily"></div></div>
        </div>
      </div>
      <!-- Entradas por mês -->
      <div class="card">
        <div class="card-head"><h3>Entradas por Mês</h3></div>
        <div class="card-body">
          <div class="chart-area"><div class="bar-chart" id="chart-monthly"></div></div>
        </div>
      </div>
    </div>

    <!-- Entradas por procedimento -->
    <div class="card">
      <div class="card-head"><h3>Entrada por Procedimento</h3></div>
      <div class="card-body">
        <div class="chart-area"><div class="donut-wrap" id="chart-procedures"></div></div>
      </div>
    </div>
  `;
}

async function loadCharts(startDate, endDate) {
  try {
    let query = supabase.from('procedures').select('date, value, procedure_name, paid').eq('paid', true);
    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);

    const { data: procs, error } = await query;
    if (error) throw error;

    renderDailyChart(procs || []);
    renderMonthlyChart(procs || []);
    renderProcedureChart(procs || []);

    // Wire filter buttons
    const btnFilter = document.getElementById('btn-filter');
    const btnClear = document.getElementById('btn-clear');
    if (btnFilter) {
      btnFilter.onclick = () => {
        const s = document.getElementById('filter-start').value;
        const e = document.getElementById('filter-end').value;
        loadCharts(s || null, e || null);
      };
    }
    if (btnClear) {
      btnClear.onclick = () => {
        document.getElementById('filter-start').value = '';
        document.getElementById('filter-end').value = '';
        loadCharts();
      };
    }

  } catch (err) {
    console.error('Charts error:', err);
  }
}

function renderDailyChart(procs) {
  const container = document.getElementById('chart-daily');
  if (!container) return;

  // Group by last 7 days
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = fmtDateISO(d);
    const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const total = procs.filter(p => p.date === key).reduce((s, p) => s + (p.value || 0), 0);
    days.push({ label, total });
  }

  const max = Math.max(...days.map(d => d.total), 1);
  container.innerHTML = days.map(d => `
    <div class="bar-group">
      <div class="bar-wrap">
        <div class="bar" style="height:0%" data-h="${(d.total / max * 100)}" title="${fmtCurrency(d.total)}"></div>
      </div>
      <span class="bar-lbl">${d.label}</span>
    </div>
  `).join('');

  requestAnimationFrame(() => {
    setTimeout(() => {
      container.querySelectorAll('.bar').forEach(b => b.style.height = b.dataset.h + '%');
    }, 100);
  });
}

function renderMonthlyChart(procs) {
  const container = document.getElementById('chart-monthly');
  if (!container) return;

  const months = {};
  const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  procs.forEach(p => {
    const m = p.date?.slice(0, 7); // YYYY-MM
    if (m) months[m] = (months[m] || 0) + (p.value || 0);
  });

  // Last 6 months
  const today = new Date();
  const entries = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = fmtDateISO(d).slice(0, 7);
    entries.push({ label: monthNames[d.getMonth()], total: months[key] || 0 });
  }

  const max = Math.max(...entries.map(e => e.total), 1);
  container.innerHTML = entries.map(e => `
    <div class="bar-group">
      <div class="bar-wrap">
        <div class="bar" style="height:0%" data-h="${(e.total / max * 100)}" title="${fmtCurrency(e.total)}"></div>
      </div>
      <span class="bar-lbl">${e.label}</span>
    </div>
  `).join('');

  requestAnimationFrame(() => {
    setTimeout(() => {
      container.querySelectorAll('.bar').forEach(b => b.style.height = b.dataset.h + '%');
    }, 150);
  });
}

function renderProcedureChart(procs) {
  const container = document.getElementById('chart-procedures');
  if (!container) return;

  const groups = {};
  procs.forEach(p => {
    const name = p.procedure_name || 'Outros';
    groups[name] = (groups[name] || 0) + (p.value || 0);
  });

  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  const colors = ['#2cd299','#6c63ff','#3b82f6','#f59e0b','#ef4444','#8b8fa3'];
  const r = 60;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  const segs = sorted.map(([name, val], i) => {
    const len = (val / total) * circ;
    const seg = `<circle class="donut-seg" cx="90" cy="90" r="${r}" stroke="${colors[i]}" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return seg;
  }).join('');

  const legend = sorted.map(([name, val], i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${colors[i]}"></span>
      <span>${name}</span>
      <span class="legend-val">${fmtCurrency(val)}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <svg class="donut-svg" viewBox="0 0 180 180">
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="26"/>
      ${segs}
    </svg>
    <div class="legend">${legend}</div>
  `;
}

// Init on load
init();
