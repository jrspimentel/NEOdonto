// js/pacientes.js — Patients page (integrated with new DB structure)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtCurrency, getInitials, avatarColor, toast, confirmAction } from './layout.js';

let currentUser = null;
let patients = [];
let searchQuery = '';
let currentPage = 1;
const perPage = 10;

let selectedPatient = null;
let selectedHistory = [];
let selectedPayments = [];
let selectedClinicalRecords = [];
let selectedOdontogramEntries = [];
let selectedTreatmentPlans = [];

// Lookup caches
let professionals = [];
let proceduresCatalog = [];
let insurancesList = [];

// FDI tooth numbering
const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const FDI_UPPER_LEFT  = [21, 22, 23, 24, 25, 26, 27, 28];
const FDI_LOWER_LEFT  = [38, 37, 36, 35, 34, 33, 32, 31];
const FDI_LOWER_RIGHT = [41, 42, 43, 44, 45, 46, 47, 48];
const ALL_TEETH = [...FDI_UPPER_RIGHT, ...FDI_UPPER_LEFT, ...FDI_LOWER_LEFT, ...FDI_LOWER_RIGHT];

// Health questions config
const HEALTH_QUESTIONS = [
  { field: 'allergy_antibiotics', label: 'Possui alergia a antibióticos?', descField: 'allergy_antibiotics_desc' },
  { field: 'allergy_anesthetics', label: 'Possui alergia a anestésicos?', descField: 'allergy_anesthetics_desc' },
  { field: 'hereditary_disease', label: 'Possui alguma doença hereditária?', descField: 'hereditary_disease_desc' },
  { field: 'hypertension', label: 'Possui hipertensão arterial?', descField: 'hypertension_desc' },
  { field: 'diabetes', label: 'Possui diabetes?', descField: 'diabetes_desc' },
  { field: 'medications', label: 'Faz uso de algum medicamento?', descField: 'medications_desc' },
  { field: 'health_problems', label: 'Possui algum problema de saúde?', descField: 'health_problems_desc' },
];

const TOOTH_CONDITIONS = ['Hígido','Cariado','Restaurado','Ausente','Fraturado','Prótese','Implante','Endodontia','Extração indicada','Selante'];
const TP_STATUS_OPTIONS = ['Planejado','Aprovado','Em andamento','Concluído','Cancelado'];

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  if (!can(currentUser.profile.role, 'view_patients')) { window.location.href = 'agenda.html'; return; }

  initLayout(currentUser, 'patients');
  setupEvents();
  try { await loadLookups(); } catch(e) { console.warn('Lookups failed:', e); }
  await loadPatients();
}

async function loadLookups() {
  try {
    const [profRes, procRes, insRes] = await Promise.all([
      supabase.from('professionals').select('id, name').order('name'),
      supabase.from('procedures_catalog').select('id, name, default_value').order('name'),
      supabase.from('insurances').select('id, name').order('name'),
    ]);
    professionals = profRes.data || [];
    proceduresCatalog = procRes.data || [];
    insurancesList = insRes.data || [];
  } catch(e) {
    console.warn('Failed to load lookups:', e);
  }
}

function setupEvents() {
  document.getElementById('search-input').addEventListener('input', e => { searchQuery = e.target.value; currentPage = 1; renderTable(); });

  const btnNew = document.getElementById('btn-new-patient');
  if (btnNew) {
    if (can(currentUser.profile.role, 'create_patient')) {
      btnNew.addEventListener('click', () => openModal('create'));
    } else { btnNew.style.display = 'none'; }
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('patient-form').addEventListener('submit', handleSave);

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-bg').addEventListener('click', closeDetail);

  document.querySelectorAll('.dp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderDetailContent(tab.dataset.tab);
    });
  });

  const btnProc = document.getElementById('btn-new-procedure');
  if (btnProc) btnProc.addEventListener('click', () => openProcedureModal());

  document.getElementById('proc-modal-close')?.addEventListener('click', closeProcModal);
  document.getElementById('proc-modal-cancel')?.addEventListener('click', closeProcModal);
  document.getElementById('proc-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeProcModal(); });
  document.getElementById('proc-form')?.addEventListener('submit', handleSaveProcedure);

  // Clinical modal events
  document.getElementById('clinical-modal-close')?.addEventListener('click', closeClinicalModal);
  document.getElementById('clinical-modal-cancel')?.addEventListener('click', closeClinicalModal);
  document.getElementById('clinical-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeClinicalModal(); });
  document.getElementById('clinical-form')?.addEventListener('submit', handleSaveClinical);

  // Odontogram modal events
  document.getElementById('odonto-modal-close')?.addEventListener('click', closeOdontoModal);
  document.getElementById('odonto-modal-cancel')?.addEventListener('click', closeOdontoModal);
  document.getElementById('odonto-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeOdontoModal(); });
  document.getElementById('odonto-form')?.addEventListener('submit', handleSaveOdonto);

  // Treatment plan item modal events
  document.getElementById('tp-item-modal-close')?.addEventListener('click', closeTpItemModal);
  document.getElementById('tp-item-modal-cancel')?.addEventListener('click', closeTpItemModal);
  document.getElementById('tp-item-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeTpItemModal(); });
  document.getElementById('tp-item-form')?.addEventListener('submit', handleSaveTpItem);
}

// ========== Load patients ==========
async function loadPatients() {
  const tbody = document.getElementById('patients-table-body');
  tbody.innerHTML = '<tr><td colspan="5"><div class="page-loader"><span class="spinner"></span> Carregando...</div></td></tr>';
  const { data, error } = await supabase.from('patients').select('*').order('name');
  if (error) { toast('Erro ao carregar pacientes: ' + error.message, 'err'); console.error(error); return; }
  patients = data || [];
  renderTable();
}

// ========== Render table ==========
function renderTable() {
  const role = currentUser.profile.role;
  const tbody = document.getElementById('patients-table-body');
  const q = searchQuery.toLowerCase();
  const filtered = patients.filter(p =>
    p.name?.toLowerCase().includes(q) || p.cpf?.includes(q) || p.email?.toLowerCase().includes(q) || p.phone?.includes(q)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * perPage;
  const page = filtered.slice(start, start + perPage);

  if (page.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><p>Nenhum paciente encontrado</p></div></td></tr>';
  } else {
    tbody.innerHTML = page.map(p => `
      <tr data-id="${p.id}" class="clickable-row">
        <td><div class="p-cell"><div class="p-av" style="background:${avatarColor(p.name)}">${getInitials(p.name)}</div><div><div class="p-name">${p.name}</div><div class="p-sub">${p.email || ''}</div></div></div></td>
        <td>${p.cpf || '—'}</td>
        <td>${p.phone || '—'}</td>
        <td>${p.birth_date ? fmtDate(p.birth_date) : '—'}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn-icon" title="Ver detalhes" data-action="view" data-id="${p.id}">${Icons.eye}</button>
            ${can(role, 'edit_patient') ? `<button class="btn-icon" title="Editar" data-action="edit" data-id="${p.id}">${Icons.edit}</button>` : ''}
            ${can(role, 'delete_patient') ? `<button class="btn-icon danger" title="Excluir" data-action="delete" data-id="${p.id}">${Icons.trash}</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }

  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'view') openDetail(id);
      else if (btn.dataset.action === 'edit') openModal('edit', id);
      else if (btn.dataset.action === 'delete') deletePatient(id);
    });
  });

  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });

  renderPagination(filtered.length, totalPages);
}

function renderPagination(total, totalPages) {
  const pg = document.getElementById('pagination');
  const start = (currentPage - 1) * perPage + 1;
  const end = Math.min(currentPage * perPage, total);
  pg.innerHTML = `
    <div class="pg-info">Mostrando ${total > 0 ? start : 0}–${end} de ${total}</div>
    <div class="pg-btns">
      <button class="pg-btn" ${currentPage === 1 ? 'disabled' : ''} data-pg="${currentPage - 1}">${Icons.chevL}</button>
      ${Array.from({ length: totalPages }, (_, i) => `<button class="pg-btn ${i+1===currentPage?'active':''}" data-pg="${i+1}">${i+1}</button>`).join('')}
      <button class="pg-btn" ${currentPage === totalPages ? 'disabled' : ''} data-pg="${currentPage + 1}">${Icons.chevR}</button>
    </div>
  `;
  pg.querySelectorAll('[data-pg]').forEach(btn => {
    btn.addEventListener('click', () => { const p = parseInt(btn.dataset.pg); if (p >= 1 && p <= totalPages) { currentPage = p; renderTable(); } });
  });
}

// ========== Patient Modal ==========
function openModal(mode, id = null) {
  const form = document.getElementById('patient-form');
  form.reset(); form.dataset.mode = mode; form.dataset.patientId = id || '';

  if (mode === 'edit' && id) {
    document.getElementById('modal-title').textContent = 'Editar Paciente';
    const p = patients.find(x => x.id === id);
    if (!p) return;
    form.querySelector('[name="name"]').value = p.name || '';
    form.querySelector('[name="cpf"]').value = p.cpf || '';
    form.querySelector('[name="birth_date"]').value = p.birth_date || '';
    form.querySelector('[name="phone"]').value = p.phone || '';
    form.querySelector('[name="is_whatsapp"]').checked = p.is_whatsapp || false;
    form.querySelector('[name="email"]').value = p.email || '';
    form.querySelector('[name="address"]').value = p.address || '';
    form.querySelector('[name="legal_guardian_name"]').value = p.legal_guardian_name || '';
    form.querySelector('[name="notes"]').value = p.notes || '';
  } else {
    document.getElementById('modal-title').textContent = 'Novo Paciente';
  }
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

async function handleSave(e) {
  e.preventDefault();
  const form = e.target; const fd = new FormData(form);
  const data = {
    name: fd.get('name'), cpf: fd.get('cpf'), birth_date: fd.get('birth_date') || null,
    phone: fd.get('phone'), is_whatsapp: form.querySelector('[name="is_whatsapp"]').checked,
    email: fd.get('email'), address: fd.get('address'), legal_guardian_name: fd.get('legal_guardian_name'), notes: fd.get('notes'),
  };
  if (!data.name) { toast('Nome é obrigatório', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('patients').insert([data]);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Paciente cadastrado!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('patients').update(data).eq('id', form.dataset.patientId);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Paciente atualizado!');
  }
  closeModal(); await loadPatients();
}

async function deletePatient(id) {
  const p = patients.find(x => x.id === id);
  if (!p || !confirmAction(`Deseja excluir ${p.name}?`)) return;
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Paciente removido'); await loadPatients();
}

// ========== Detail panel ==========
async function openDetail(id) {
  selectedPatient = patients.find(x => x.id === id);
  if (!selectedPatient) return;

  // Load appointment history (no joins - use lookup caches)
  try {
    const { data: history, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('patient_id', id)
      .order('appointment_date', { ascending: false });
    if (error) console.warn('History load error:', error);
    const raw = history || [];
    // Enrich with lookup names
    const profMap = {}; professionals.forEach(p => profMap[p.id] = p.name);
    const procMap = {}; proceduresCatalog.forEach(p => procMap[p.id] = p.name);
    const insMap = {}; insurancesList.forEach(p => insMap[p.id] = p.name);
    selectedHistory = raw.map(h => ({
      ...h,
      professional_name: profMap[h.professional_id] || '—',
      procedure_name: procMap[h.procedure_id] || '—',
      insurance_name: insMap[h.insurance_id] || '—',
    }));
  } catch(e) {
    console.warn('History query failed:', e);
    selectedHistory = [];
  }

  // Load payment history (no joins)
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false });
    if (error) console.warn('Payments load error:', error);
    // Enrich with procedure names from appointments
    const payRaw = payments || [];
    const procMap = {}; proceduresCatalog.forEach(p => procMap[p.id] = p.name);
    selectedPayments = payRaw.map(p => {
      const appt = selectedHistory.find(h => h.id === p.appointment_id);
      return {
        ...p,
        procedure_name: appt ? procMap[appt.procedure_id] || '—' : '—',
        appointment_date: appt?.appointment_date || '—',
      };
    });
  } catch(e) {
    console.warn('Payments query failed:', e);
    selectedPayments = [];
  }

  // Load clinical records
  try {
    const { data, error } = await supabase
      .from('clinical_records')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false });
    if (error) console.warn('Clinical records load error:', error);
    const profMap = {}; professionals.forEach(p => profMap[p.id] = p.name);
    selectedClinicalRecords = (data || []).map(r => ({
      ...r,
      professional_name: profMap[r.professional_id] || '—',
    }));
  } catch(e) {
    console.warn('Clinical records query failed:', e);
    selectedClinicalRecords = [];
  }

  // Load odontogram entries
  try {
    const { data, error } = await supabase
      .from('odontogram_entries')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false });
    if (error) console.warn('Odontogram load error:', error);
    const profMap = {}; professionals.forEach(p => profMap[p.id] = p.name);
    selectedOdontogramEntries = (data || []).map(e => ({
      ...e,
      professional_name: profMap[e.professional_id] || '—',
    }));
  } catch(e) {
    console.warn('Odontogram query failed:', e);
    selectedOdontogramEntries = [];
  }

  // Load treatment plans with items
  try {
    const { data: plans, error } = await supabase
      .from('treatment_plans')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false });
    if (error) console.warn('Treatment plans load error:', error);
    const profMap = {}; professionals.forEach(p => profMap[p.id] = p.name);
    const plansData = plans || [];

    // Load items for all plans
    const planIds = plansData.map(p => p.id);
    let allItems = [];
    if (planIds.length > 0) {
      const { data: items } = await supabase
        .from('treatment_plan_items')
        .select('*')
        .in('plan_id', planIds)
        .order('created_at');
      allItems = items || [];
    }

    selectedTreatmentPlans = plansData.map(plan => ({
      ...plan,
      professional_name: profMap[plan.professional_id] || '—',
      items: allItems.filter(i => i.plan_id === plan.id).map(i => ({
        ...i,
        professional_name: profMap[i.professional_id] || '—',
      })),
    }));
  } catch(e) {
    console.warn('Treatment plans query failed:', e);
    selectedTreatmentPlans = [];
  }

  const p = selectedPatient;
  document.getElementById('dp-avatar').style.background = avatarColor(p.name);
  document.getElementById('dp-avatar').textContent = getInitials(p.name);
  document.getElementById('dp-name').textContent = p.name;

  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="info"]').classList.add('active');
  renderDetailContent('info');

  const btnProc = document.getElementById('btn-new-procedure');
  if (btnProc) btnProc.style.display = can(currentUser.profile.role, 'create_procedure') ? '' : 'none';

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-bg').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-bg').classList.remove('open');
}

function renderDetailContent(tab) {
  const content = document.getElementById('dp-content');
  const p = selectedPatient;
  if (!p) return;

  if (tab === 'info') {
    renderInfoTab(content, p);
  } else if (tab === 'clinical') {
    renderClinicalTab(content);
  } else if (tab === 'odontogram') {
    renderOdontogramTab(content);
  } else if (tab === 'treatment') {
    renderTreatmentTab(content);
  } else if (tab === 'history') {
    renderHistoryTab(content);
  } else if (tab === 'financial') {
    renderFinancialTab(content);
  }
}

// ---- Info Tab ----
function renderInfoTab(content, p) {
  const totalInvested = selectedHistory.reduce((s, h) => s + (h.value || 0), 0);
  content.innerHTML = `
    <div style="margin-bottom:24px">
      <h4 style="font-size:.88rem;font-weight:700;margin-bottom:14px">Dados Cadastrais</h4>
      <div class="dp-field-grid">
        <div class="dp-field"><label>Nome</label><p>${p.name}</p></div>
        <div class="dp-field"><label>CPF</label><p>${p.cpf || '—'}</p></div>
        <div class="dp-field"><label>Nascimento</label><p>${p.birth_date ? fmtDate(p.birth_date) : '—'}</p></div>
        <div class="dp-field"><label>Telefone</label><p>${p.phone || '—'} ${p.is_whatsapp ? '(WhatsApp)' : ''}</p></div>
        <div class="dp-field"><label>E-mail</label><p>${p.email || '—'}</p></div>
        <div class="dp-field"><label>Endereço</label><p>${p.address || '—'}</p></div>
        ${p.legal_guardian_name ? `<div class="dp-field"><label>Responsável</label><p>${p.legal_guardian_name}</p></div>` : ''}
      </div>
      ${p.notes ? `<div class="dp-field" style="margin-top:14px"><label>Observações</label><p>${p.notes}</p></div>` : ''}
    </div>
    <div>
      <h4 style="font-size:.88rem;font-weight:700;margin-bottom:14px">Resumo</h4>
      <div class="dp-field-grid">
        <div class="dp-field"><label>Total de Atendimentos</label><p>${selectedHistory.length}</p></div>
        <div class="dp-field"><label>Total Investido</label><p style="color:var(--p-400);font-weight:700">${fmtCurrency(totalInvested)}</p></div>
        <div class="dp-field"><label>Fichas Clínicas</label><p>${selectedClinicalRecords.length}</p></div>
        <div class="dp-field"><label>Planos de Tratamento</label><p>${selectedTreatmentPlans.length}</p></div>
      </div>
    </div>
  `;
}

// ---- Clinical Tab ----
function renderClinicalTab(content) {
  const role = currentUser.profile.role;
  const canCreate = can(role, 'create_clinical');

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
    <h4 style="font-size:.88rem;font-weight:700">Fichas Clínicas</h4>
    ${canCreate ? `<button class="btn btn-p btn-sm" id="btn-new-clinical">${Icons.plus} Nova Ficha</button>` : ''}
  </div>`;

  if (selectedClinicalRecords.length === 0) {
    html += '<div class="empty"><p>Nenhuma ficha clínica registrada</p></div>';
  } else {
    html += '<div class="timeline">';
    selectedClinicalRecords.forEach(r => {
      const date = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') + ' — ' + new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
      html += `<div class="tl-item">
        <div class="tl-date">${date}</div>
        <div class="tl-doc">Dentista: ${r.professional_name}</div>
        <div class="clinical-summary" style="margin-top:10px">
          ${HEALTH_QUESTIONS.map(q => {
            const val = r[q.field] || 'Não informado';
            const desc = r[q.descField] || '';
            const cls = val === 'Sim' ? 'sim' : val === 'Não' ? 'nao' : 'ni';
            return `<div class="clinical-item">
              <div class="clinical-item-label">${q.label.replace('Possui ', '').replace('Faz uso de ', '').replace('?','')}</div>
              <div class="clinical-item-value ${cls}">${val}</div>
              ${desc ? `<div class="clinical-item-desc">${desc}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
        ${r.health_notes ? `<div class="tl-notes"><strong>Obs. saúde:</strong> ${r.health_notes}</div>` : ''}
        ${r.notes ? `<div class="tl-notes"><strong>Obs. gerais:</strong> ${r.notes}</div>` : ''}
      </div>`;
    });
    html += '</div>';
  }

  content.innerHTML = html;

  content.querySelector('#btn-new-clinical')?.addEventListener('click', () => openClinicalModal());
}

// ---- Odontogram Tab ----
function renderOdontogramTab(content) {
  const role = currentUser.profile.role;
  const canCreate = can(role, 'create_odontogram');

  // Build a map of latest condition per tooth
  const toothMap = {};
  selectedOdontogramEntries.forEach(e => {
    if (!toothMap[e.tooth_number]) {
      toothMap[e.tooth_number] = e; // first entry is latest (ordered by created_at DESC)
    }
  });

  function getToothClass(num) {
    const entry = toothMap[num];
    if (!entry) return '';
    const cond = (entry.tooth_condition || '').toLowerCase();
    if (cond.includes('cariado')) return 'condition-cariado';
    if (cond.includes('restaurado')) return 'condition-restaurado';
    if (cond.includes('ausente')) return 'condition-ausente';
    if (cond.includes('fraturado')) return 'condition-fraturado';
    if (cond.includes('prótese') || cond.includes('protese') || cond.includes('implante')) return 'condition-protese';
    return 'has-record';
  }

  function renderRow(leftTeeth, rightTeeth, label) {
    return `<div class="odontogram-row">
      <span class="odontogram-label">${label}</span>
      <div class="tooth-group">
        ${leftTeeth.map(n => `<button class="tooth-btn ${getToothClass(n)}" data-tooth="${n}" title="Dente ${n}">${n}</button>`).join('')}
      </div>
      <div class="odontogram-divider"></div>
      <div class="tooth-group">
        ${rightTeeth.map(n => `<button class="tooth-btn ${getToothClass(n)}" data-tooth="${n}" title="Dente ${n}">${n}</button>`).join('')}
      </div>
    </div>`;
  }

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <h4 style="font-size:.88rem;font-weight:700">Odontograma</h4>
  </div>
  <div class="odontogram-container">
    <div class="odontogram-arch">
      ${renderRow(FDI_UPPER_RIGHT, FDI_UPPER_LEFT, 'SUP')}
      ${renderRow(FDI_LOWER_LEFT.slice().reverse(), FDI_LOWER_RIGHT, 'INF')}
    </div>
    <div class="odontogram-legend">
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(26,179,134,.5)"></div> Registrado</div>
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(239,68,68,.5)"></div> Cariado</div>
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(59,130,246,.5)"></div> Restaurado</div>
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(255,255,255,.15)"></div> Ausente</div>
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(245,158,11,.5)"></div> Fraturado</div>
      <div class="odontogram-legend-item"><div class="odontogram-legend-dot" style="background:rgba(108,99,255,.5)"></div> Prótese/Implante</div>
    </div>
  </div>
  <div id="tooth-detail-area"></div>`;

  content.innerHTML = html;

  // Tooth click events
  content.querySelectorAll('.tooth-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const toothNum = parseInt(btn.dataset.tooth);
      content.querySelectorAll('.tooth-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      showToothDetail(toothNum, canCreate);
    });
  });
}

function showToothDetail(toothNum, canCreate) {
  const area = document.getElementById('tooth-detail-area');
  const entries = selectedOdontogramEntries.filter(e => e.tooth_number === toothNum);

  let html = `<div class="tooth-detail">
    <div class="tooth-detail-header">
      <h4>Dente ${toothNum}</h4>
      ${canCreate ? `<button class="btn btn-p btn-sm" id="btn-add-odonto-entry" data-tooth="${toothNum}">${Icons.plus} Registrar</button>` : ''}
    </div>`;

  if (entries.length === 0) {
    html += '<p style="font-size:.82rem;color:var(--t3)">Nenhum registro para este dente.</p>';
  } else {
    entries.forEach(e => {
      const date = e.record_date ? fmtDate(e.record_date) : (e.created_at ? new Date(e.created_at).toLocaleDateString('pt-BR') : '—');
      html += `<div class="tooth-history-item">
        <div class="tooth-history-date">${date} — ${e.professional_name}</div>
        <div class="tooth-history-condition">Condição: ${e.tooth_condition || '—'}</div>
        ${e.procedure_performed ? `<div class="tooth-history-proc">Procedimento: ${e.procedure_performed}</div>` : ''}
        ${e.observation ? `<div style="font-size:.78rem;color:var(--t3);margin-top:2px">${e.observation}</div>` : ''}
      </div>`;
    });
  }
  html += '</div>';
  area.innerHTML = html;

  area.querySelector('#btn-add-odonto-entry')?.addEventListener('click', (ev) => {
    const tooth = parseInt(ev.currentTarget.dataset.tooth);
    openOdontoModal(tooth);
  });
}

// ---- Treatment Tab ----
function renderTreatmentTab(content) {
  const role = currentUser.profile.role;
  const canCreate = can(role, 'create_treatment_plan');

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
    <h4 style="font-size:.88rem;font-weight:700">Planos de Tratamento</h4>
    ${canCreate ? `<button class="btn btn-p btn-sm" id="btn-new-tp">${Icons.plus} Novo Plano</button>` : ''}
  </div>`;

  if (selectedTreatmentPlans.length === 0) {
    html += '<div class="empty"><p>Nenhum plano de tratamento registrado</p></div>';
  } else {
    selectedTreatmentPlans.forEach((plan, idx) => {
      const items = plan.items || [];
      const subtotal = items.reduce((s, i) => s + ((i.unit_value || 0) * (i.quantity || 1)), 0);
      const discount = plan.discount || 0;
      const total = subtotal - discount;
      const concluded = items.filter(i => i.status === 'Concluído').length;
      const pending = items.filter(i => i.status !== 'Concluído' && i.status !== 'Cancelado').length;

      const statusBadge = {
        'Planejado': 'badge-blue',
        'Aprovado': 'badge-purple',
        'Em andamento': 'badge-orange',
        'Concluído': 'badge-green',
        'Cancelado': 'badge-gray',
      }[plan.status] || 'badge-gray';

      html += `<div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <div>
            <h3 style="margin-bottom:4px">${plan.plan_name || 'Plano de Tratamento'}</h3>
            <span style="font-size:.72rem;color:var(--t3)">${new Date(plan.created_at).toLocaleDateString('pt-BR')} — ${plan.professional_name}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge ${statusBadge}">${plan.status}</span>
            ${canCreate ? `<button class="btn btn-p btn-sm btn-add-tp-item" data-plan-id="${plan.id}">${Icons.plus} Item</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="tp-summary">
            <div class="tp-summary-card">
              <div class="tp-summary-label">Procedimentos</div>
              <div class="tp-summary-value">${items.length}</div>
            </div>
            <div class="tp-summary-card">
              <div class="tp-summary-label">Concluídos</div>
              <div class="tp-summary-value" style="color:var(--success)">${concluded}</div>
            </div>
            <div class="tp-summary-card">
              <div class="tp-summary-label">Pendentes</div>
              <div class="tp-summary-value" style="color:var(--warning)">${pending}</div>
            </div>
          </div>`;

      if (items.length > 0) {
        html += `<div class="table-wrap"><table>
          <thead><tr><th>Procedimento</th><th>Dente</th><th>Valor un.</th><th>Qtd</th><th>Total</th><th>Status</th></tr></thead>
          <tbody>
            ${items.map(i => {
              const itemTotal = (i.unit_value || 0) * (i.quantity || 1);
              const sBadge = {
                'Planejado': 'badge-blue',
                'Aprovado': 'badge-purple',
                'Em andamento': 'badge-orange',
                'Concluído': 'badge-green',
                'Cancelado': 'badge-gray',
              }[i.status] || 'badge-gray';
              return `<tr>
                <td><div><div style="font-weight:600">${i.procedure_name}</div>${i.description ? `<div style="font-size:.72rem;color:var(--t3)">${i.description}</div>` : ''}</div></td>
                <td>${i.tooth_number || 'N/A'}</td>
                <td>${fmtCurrency(i.unit_value || 0)}</td>
                <td>${i.quantity || 1}</td>
                <td style="font-weight:600">${fmtCurrency(itemTotal)}</td>
                <td><span class="badge ${sBadge}">${i.status}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`;
      }

      html += `<div class="tp-totals">
          <div class="tp-total-row"><span>Subtotal</span><span style="font-weight:600">${fmtCurrency(subtotal)}</span></div>
          ${discount > 0 ? `<div class="tp-total-row"><span>Desconto</span><span style="color:var(--danger);font-weight:600">- ${fmtCurrency(discount)}</span></div>` : ''}
          <div class="tp-total-row grand"><span>Total do Plano</span><span>${fmtCurrency(Math.max(0, total))}</span></div>
        </div>
        ${plan.notes ? `<div style="margin-top:10px;font-size:.82rem;color:var(--t2)"><strong>Obs:</strong> ${plan.notes}</div>` : ''}
        </div>
      </div>`;
    });
  }

  content.innerHTML = html;

  content.querySelector('#btn-new-tp')?.addEventListener('click', () => createNewTreatmentPlan());
  content.querySelectorAll('.btn-add-tp-item').forEach(btn => {
    btn.addEventListener('click', () => openTpItemModal(btn.dataset.planId));
  });
}

// ---- History Tab ----
function renderHistoryTab(content) {
  if (selectedHistory.length === 0) {
    content.innerHTML = '<div class="empty"><p>Nenhum atendimento registrado</p></div>';
  } else {
    content.innerHTML = `<div class="timeline">${selectedHistory.map(h => `
      <div class="tl-item">
        <div class="tl-date">${fmtDate(h.appointment_date)}${h.appointment_time ? ' — ' + h.appointment_time : ''}</div>
        <div class="tl-proc">${h.procedure_name || '—'}</div>
        <div class="tl-doc">${h.professional_name || '—'}</div>
        <div class="tl-meta">
          <span>Convênio: ${h.insurance_name || 'Particular'}</span>
          <span>Status: ${h.status || '—'}</span>
        </div>
        ${h.notes ? `<div class="tl-notes">${h.notes}</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <span class="tl-cost">${fmtCurrency(h.value || 0)}</span>
        </div>
        ${can(currentUser.profile.role, 'edit_procedure') ? `
          <div style="margin-top:8px;display:flex;gap:6px">
            <button class="btn btn-s btn-sm" data-edit-proc="${h.id}">${Icons.edit} Editar</button>
            ${can(currentUser.profile.role, 'delete_procedure') ? `<button class="btn btn-d btn-sm" data-del-proc="${h.id}">${Icons.trash} Excluir</button>` : ''}
          </div>
        ` : ''}
      </div>
    `).join('')}</div>`;

    content.querySelectorAll('[data-edit-proc]').forEach(btn => {
      btn.addEventListener('click', () => openProcedureModal(btn.dataset.editProc));
    });
    content.querySelectorAll('[data-del-proc]').forEach(btn => {
      btn.addEventListener('click', () => deleteProcedure(btn.dataset.delProc));
    });
  }
}

// ---- Financial Tab ----
function renderFinancialTab(content) {
  // Financial history
  const totalPaid = selectedPayments.filter(p => p.payment_status === 'Pago').reduce((s, p) => s + (p.final_amount || 0), 0);
  const totalExpected = selectedHistory.reduce((s, h) => s + (h.value || 0), 0);
  const balance = totalExpected - totalPaid;

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
      <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);text-align:center">
        <div style="font-size:.72rem;color:var(--t3)">Total</div>
        <div style="font-size:1.1rem;font-weight:700">${fmtCurrency(totalExpected)}</div>
      </div>
      <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);text-align:center">
        <div style="font-size:.72rem;color:var(--t3)">Pago</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--success)">${fmtCurrency(totalPaid)}</div>
      </div>
      <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);text-align:center">
        <div style="font-size:.72rem;color:var(--t3)">Saldo</div>
        <div style="font-size:1.1rem;font-weight:700;color:${balance > 0 ? 'var(--warning)' : 'var(--success)'}">${fmtCurrency(Math.max(0, balance))}</div>
      </div>
    </div>
    ${selectedPayments.length > 0 ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Procedimento</th><th>Valor</th><th>Pago</th><th>Método</th><th>Status</th></tr></thead>
          <tbody>
            ${selectedPayments.map(p => `
              <tr>
                <td>${p.paid_at ? fmtDate(p.paid_at.split('T')[0]) : '—'}</td>
                <td>${p.procedure_name || '—'}</td>
                <td>${fmtCurrency(p.amount || 0)}</td>
                <td>${fmtCurrency(p.final_amount || 0)}</td>
                <td>${p.payment_method || '—'}</td>
                <td><span class="badge ${p.payment_status === 'Pago' ? 'badge-green' : p.payment_status === 'Cancelado' ? 'badge-gray' : 'badge-orange'}">${p.payment_status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '<div class="empty"><p>Nenhum pagamento registrado</p></div>'}
  `;
}

// ========== Procedure Modal (existing) ==========
function fillSelect(sel, items) {
  sel.innerHTML = '<option value="">Selecione...</option>';
  items.forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; sel.appendChild(o); });
}

async function openProcedureModal(procId = null) {
  const form = document.getElementById('proc-form');
  form.reset();

  // Populate selects from lookups
  fillSelect(form.querySelector('[name="professional_id"]'), professionals);
  fillSelect(form.querySelector('[name="procedure_id"]'), proceduresCatalog);
  fillSelect(form.querySelector('[name="insurance_id"]'), insurancesList);

  // Auto-fill value when procedure changes
  form.querySelector('[name="procedure_id"]').addEventListener('change', function() {
    const proc = proceduresCatalog.find(p => p.id === this.value);
    if (proc && proc.default_value) form.querySelector('[name="value"]').value = proc.default_value;
  });

  if (procId) {
    document.getElementById('proc-modal-title').textContent = 'Editar Atendimento';
    form.dataset.mode = 'edit';
    form.dataset.procId = procId;
    const proc = selectedHistory.find(h => h.id === procId);
    if (proc) {
      form.querySelector('[name="professional_id"]').value = proc.professional_id || '';
      form.querySelector('[name="procedure_id"]').value = proc.procedure_id || '';
      form.querySelector('[name="appointment_date"]').value = proc.appointment_date || '';
      form.querySelector('[name="appointment_time"]').value = proc.appointment_time || '';
      form.querySelector('[name="insurance_id"]').value = proc.insurance_id || '';
      form.querySelector('[name="value"]').value = proc.value || '';
      form.querySelector('[name="status"]').value = proc.status || 'Agendado';
      form.querySelector('[name="notes"]').value = proc.notes || '';
    }
  } else {
    document.getElementById('proc-modal-title').textContent = 'Novo Atendimento';
    form.dataset.mode = 'create';
    form.dataset.procId = '';
    form.querySelector('[name="appointment_date"]').value = new Date().toISOString().split('T')[0];
  }
  document.getElementById('proc-overlay').classList.add('open');
}

function closeProcModal() { document.getElementById('proc-overlay').classList.remove('open'); }

async function handleSaveProcedure(e) {
  e.preventDefault();
  const form = e.target; const fd = new FormData(form);
  const data = {
    patient_id: selectedPatient.id,
    professional_id: fd.get('professional_id') || null,
    procedure_id: fd.get('procedure_id') || null,
    appointment_date: fd.get('appointment_date'),
    appointment_time: fd.get('appointment_time'),
    insurance_id: fd.get('insurance_id') || null,
    value: parseFloat(fd.get('value')) || 0,
    status: fd.get('status'),
    notes: fd.get('notes'),
  };

  if (!data.professional_id) { toast('Selecione um profissional', 'err'); return; }
  if (!data.procedure_id) { toast('Selecione um procedimento', 'err'); return; }
  if (!data.appointment_date) { toast('Data é obrigatória', 'err'); return; }
  if (!data.appointment_time) { toast('Hora é obrigatória', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('appointments').insert([data]);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Atendimento registrado!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('appointments').update(data).eq('id', form.dataset.procId);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Atendimento atualizado!');
  }
  closeProcModal(); await openDetail(selectedPatient.id);
}

async function deleteProcedure(procId) {
  if (!confirmAction('Deseja excluir este atendimento?')) return;
  const { error } = await supabase.from('appointments').delete().eq('id', procId);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Atendimento removido');
  await openDetail(selectedPatient.id);
}

// ========== Clinical Record Modal ==========
function openClinicalModal() {
  const form = document.getElementById('clinical-form');
  form.reset();
  form.dataset.mode = 'create';
  document.getElementById('clinical-modal-title').textContent = 'Nova Ficha Clínica';

  fillSelect(form.querySelector('[name="professional_id"]'), professionals);

  // Populate appointments select
  const apptSel = form.querySelector('[name="appointment_id"]');
  apptSel.innerHTML = '<option value="">Nenhum</option>';
  selectedHistory.forEach(h => {
    const o = document.createElement('option');
    o.value = h.id;
    o.textContent = `${fmtDate(h.appointment_date)} — ${h.procedure_name}`;
    apptSel.appendChild(o);
  });

  // Render health questions
  const container = document.getElementById('health-questions-container');
  container.innerHTML = HEALTH_QUESTIONS.map(q => `
    <div class="health-question" data-field="${q.field}">
      <div class="health-question-header">
        <span class="health-question-label">${q.label}</span>
        <div class="health-question-options">
          <button type="button" class="health-option" data-value="Sim" data-field="${q.field}">Sim</button>
          <button type="button" class="health-option" data-value="Não" data-field="${q.field}">Não</button>
          <button type="button" class="health-option selected-ni" data-value="Não informado" data-field="${q.field}">N/I</button>
        </div>
      </div>
      <div class="health-desc-input" style="display:none" data-desc-for="${q.field}">
        <input type="text" placeholder="Descreva..." data-desc-field="${q.descField}"/>
      </div>
    </div>
  `).join('');

  // Health option click handlers
  container.querySelectorAll('.health-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const value = btn.dataset.value;
      // Reset siblings
      container.querySelectorAll(`.health-option[data-field="${field}"]`).forEach(b => {
        b.classList.remove('selected-sim', 'selected-nao', 'selected-ni');
      });
      // Set selected
      if (value === 'Sim') btn.classList.add('selected-sim');
      else if (value === 'Não') btn.classList.add('selected-nao');
      else btn.classList.add('selected-ni');

      // Toggle description field
      const descDiv = container.querySelector(`[data-desc-for="${field}"]`);
      if (descDiv) {
        descDiv.style.display = value === 'Sim' ? 'block' : 'none';
      }
    });
  });

  document.getElementById('clinical-overlay').classList.add('open');
}

function closeClinicalModal() { document.getElementById('clinical-overlay').classList.remove('open'); }

async function handleSaveClinical(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const container = document.getElementById('health-questions-container');

  const data = {
    patient_id: selectedPatient.id,
    professional_id: fd.get('professional_id') || null,
    appointment_id: fd.get('appointment_id') || null,
    health_notes: fd.get('health_notes') || '',
    notes: fd.get('notes') || '',
  };

  if (!data.professional_id) { toast('Selecione o dentista responsável', 'err'); return; }

  // Extract health question answers
  HEALTH_QUESTIONS.forEach(q => {
    const selectedBtn = container.querySelector(`.health-option[data-field="${q.field}"].selected-sim, .health-option[data-field="${q.field}"].selected-nao, .health-option[data-field="${q.field}"].selected-ni`);
    data[q.field] = selectedBtn ? selectedBtn.dataset.value : 'Não informado';
    const descInput = container.querySelector(`[data-desc-field="${q.descField}"]`);
    data[q.descField] = (data[q.field] === 'Sim' && descInput) ? descInput.value : '';
  });

  const { error } = await supabase.from('clinical_records').insert([data]);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Ficha clínica salva!');
  closeClinicalModal();
  await openDetail(selectedPatient.id);
  // Switch to clinical tab
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="clinical"]').classList.add('active');
  renderDetailContent('clinical');
}

// ========== Odontogram Modal ==========
function openOdontoModal(toothNum) {
  const form = document.getElementById('odonto-form');
  form.reset();
  form.dataset.mode = 'create';
  document.getElementById('odonto-modal-title').textContent = `Registrar — Dente ${toothNum}`;
  form.querySelector('[name="tooth_number"]').value = toothNum;
  form.querySelector('[name="record_date"]').value = new Date().toISOString().split('T')[0];
  fillSelect(form.querySelector('[name="professional_id"]'), professionals);
  document.getElementById('odonto-overlay').classList.add('open');
}

function closeOdontoModal() { document.getElementById('odonto-overlay').classList.remove('open'); }

async function handleSaveOdonto(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const data = {
    patient_id: selectedPatient.id,
    tooth_number: parseInt(fd.get('tooth_number')),
    tooth_condition: fd.get('tooth_condition'),
    procedure_performed: fd.get('procedure_performed') || '',
    professional_id: fd.get('professional_id') || null,
    record_date: fd.get('record_date') || new Date().toISOString().split('T')[0],
    observation: fd.get('observation') || '',
  };

  if (!data.tooth_condition) { toast('Selecione a condição do dente', 'err'); return; }
  if (!data.professional_id) { toast('Selecione o dentista responsável', 'err'); return; }

  const { error } = await supabase.from('odontogram_entries').insert([data]);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Odontograma atualizado!');
  closeOdontoModal();
  await openDetail(selectedPatient.id);
  // Switch to odontogram tab
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="odontogram"]').classList.add('active');
  renderDetailContent('odontogram');
}

// ========== Treatment Plan ==========
async function createNewTreatmentPlan() {
  const profId = professionals.length > 0 ? professionals[0].id : null;

  const data = {
    patient_id: selectedPatient.id,
    professional_id: profId,
    plan_name: 'Plano de Tratamento',
    status: 'Planejado',
    subtotal: 0,
    discount: 0,
    total: 0,
  };

  const { error } = await supabase.from('treatment_plans').insert([data]);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Plano de tratamento criado!');
  await openDetail(selectedPatient.id);
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="treatment"]').classList.add('active');
  renderDetailContent('treatment');
}

// ========== Treatment Plan Item Modal ==========
let currentPlanId = null;

function openTpItemModal(planId) {
  currentPlanId = planId;
  const form = document.getElementById('tp-item-form');
  form.reset();
  form.dataset.mode = 'create';
  document.getElementById('tp-item-modal-title').textContent = 'Adicionar Procedimento ao Plano';

  fillSelect(form.querySelector('[name="professional_id"]'), professionals);

  // Populate tooth select
  const toothSel = form.querySelector('[name="tooth_number"]');
  toothSel.innerHTML = '<option value="">Não aplicável</option>';
  ALL_TEETH.forEach(n => {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = `Dente ${n}`;
    toothSel.appendChild(o);
  });

  document.getElementById('tp-item-overlay').classList.add('open');
}

function closeTpItemModal() {
  currentPlanId = null;
  document.getElementById('tp-item-overlay').classList.remove('open');
}

async function handleSaveTpItem(e) {
  e.preventDefault();
  if (!currentPlanId) { toast('Plano não selecionado', 'err'); return; }
  const form = e.target;
  const fd = new FormData(form);

  const unitValue = parseFloat(fd.get('unit_value')) || 0;
  const quantity = parseInt(fd.get('quantity')) || 1;

  const data = {
    plan_id: currentPlanId,
    patient_id: selectedPatient.id,
    professional_id: fd.get('professional_id') || null,
    procedure_name: fd.get('procedure_name'),
    tooth_number: fd.get('tooth_number') ? parseInt(fd.get('tooth_number')) : null,
    description: fd.get('description') || '',
    unit_value: unitValue,
    quantity: quantity,
    total_value: unitValue * quantity,
    status: fd.get('status') || 'Planejado',
    planned_date: fd.get('planned_date') || null,
    observation: fd.get('observation') || '',
  };

  if (!data.procedure_name) { toast('Informe o procedimento', 'err'); return; }

  const { error } = await supabase.from('treatment_plan_items').insert([data]);
  if (error) { toast('Erro: ' + error.message, 'err'); return; }

  // Recalculate plan totals
  await recalcPlanTotals(currentPlanId);

  toast('Procedimento adicionado ao plano!');
  closeTpItemModal();
  await openDetail(selectedPatient.id);
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="treatment"]').classList.add('active');
  renderDetailContent('treatment');
}

async function recalcPlanTotals(planId) {
  try {
    const { data: items } = await supabase
      .from('treatment_plan_items')
      .select('unit_value, quantity, status')
      .eq('plan_id', planId);
    if (!items) return;

    const subtotal = items
      .filter(i => i.status !== 'Cancelado')
      .reduce((s, i) => s + ((i.unit_value || 0) * (i.quantity || 1)), 0);

    // Get current plan discount
    const { data: plan } = await supabase.from('treatment_plans').select('discount').eq('id', planId).single();
    const discount = plan?.discount || 0;

    await supabase.from('treatment_plans').update({
      subtotal,
      total: subtotal - discount,
      updated_at: new Date().toISOString(),
    }).eq('id', planId);
  } catch(e) {
    console.warn('Recalc failed:', e);
  }
}

init();
