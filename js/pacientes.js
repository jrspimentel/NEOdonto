// js/pacientes.js — Patients page (integrated with new DB structure)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtCurrency, getInitials, avatarColor, toast, confirmAction, showLoader } from './layout.js';

let currentUser = null;
let patients = [];
let searchQuery = '';
let currentPage = 1;
const perPage = 10;

let selectedPatient = null;
let selectedHistory = [];
let selectedPayments = [];

// Lookup caches
let professionals = [];
let proceduresCatalog = [];
let insurancesList = [];

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
}

// ---------- Load patients ----------
async function loadPatients() {
  showLoader(document.getElementById('patients-table-body'));
  const { data, error } = await supabase.from('patients').select('*').order('name');
  if (error) { toast('Erro ao carregar pacientes', 'err'); console.error(error); return; }
  patients = data || [];
  renderTable();
}

// ---------- Render table ----------
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

// ---------- Patient Modal ----------
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

// ---------- Detail panel ----------
async function openDetail(id) {
  selectedPatient = patients.find(x => x.id === id);
  if (!selectedPatient) return;

  // Load appointment history
  try {
    const { data: history, error } = await supabase
      .from('appointments')
      .select('*, professionals(name), procedures_catalog(name), insurances(name)')
      .eq('patient_id', id)
      .order('appointment_date', { ascending: false });
    if (error) console.warn('History load error:', error);
    selectedHistory = history || [];
  } catch(e) {
    console.warn('History query failed:', e);
    selectedHistory = [];
  }

  // Load payment history
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*, appointments(appointment_date, procedure_id, procedures_catalog(name))')
      .eq('patient_id', id)
      .order('created_at', { ascending: false });
    if (error) console.warn('Payments load error:', error);
    selectedPayments = payments || [];
  } catch(e) {
    console.warn('Payments query failed:', e);
    selectedPayments = [];
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
        </div>
        ${p.notes ? `<div class="dp-field" style="margin-top:14px"><label>Observações</label><p>${p.notes}</p></div>` : ''}
      </div>
      <div>
        <h4 style="font-size:.88rem;font-weight:700;margin-bottom:14px">Resumo</h4>
        <div class="dp-field-grid">
          <div class="dp-field"><label>Total de Atendimentos</label><p>${selectedHistory.length}</p></div>
          <div class="dp-field"><label>Total Investido</label><p style="color:var(--p-400);font-weight:700">${fmtCurrency(totalInvested)}</p></div>
        </div>
      </div>
    `;
  } else if (tab === 'history') {
    if (selectedHistory.length === 0) {
      content.innerHTML = '<div class="empty"><p>Nenhum atendimento registrado</p></div>';
    } else {
      content.innerHTML = `<div class="timeline">${selectedHistory.map(h => `
        <div class="tl-item">
          <div class="tl-date">${fmtDate(h.appointment_date)}${h.appointment_time ? ' — ' + h.appointment_time : ''}</div>
          <div class="tl-proc">${h.procedures_catalog?.name || '—'}</div>
          <div class="tl-doc">${h.professionals?.name || '—'}</div>
          <div class="tl-meta">
            <span>Convênio: ${h.insurances?.name || 'Particular'}</span>
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
  } else if (tab === 'financial') {
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
                  <td>${p.appointments?.procedures_catalog?.name || '—'}</td>
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
}

// ---------- Procedure Modal ----------
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

init();
