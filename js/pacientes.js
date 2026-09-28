// js/pacientes.js — Patients page logic
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtCurrency, getInitials, avatarColor, toast, confirmAction, showLoader } from './layout.js';

let currentUser = null;
let patients = [];
let searchQuery = '';
let currentPage = 1;
const perPage = 10;

// Detail panel state
let selectedPatient = null;
let selectedHistory = [];

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const role = currentUser.profile.role;
  if (!can(role, 'view_patients')) {
    window.location.href = 'agenda.html';
    return;
  }

  initLayout(currentUser, 'patients');
  setupEvents();
  await loadPatients();
}

function setupEvents() {
  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    currentPage = 1;
    renderTable();
  });

  // New patient button
  const btnNew = document.getElementById('btn-new-patient');
  if (btnNew) {
    if (can(currentUser.profile.role, 'create_patient')) {
      btnNew.addEventListener('click', () => openModal('create'));
    } else {
      btnNew.style.display = 'none';
    }
  }

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

  // Form submit
  document.getElementById('patient-form').addEventListener('submit', handleSave);

  // Detail close
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-bg').addEventListener('click', closeDetail);

  // Detail tabs
  document.querySelectorAll('.dp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderDetailContent(tab.dataset.tab);
    });
  });

  // New procedure button
  const btnProc = document.getElementById('btn-new-procedure');
  if (btnProc) {
    btnProc.addEventListener('click', () => openProcedureModal());
  }

  // Procedure modal
  document.getElementById('proc-modal-close')?.addEventListener('click', closeProcModal);
  document.getElementById('proc-modal-cancel')?.addEventListener('click', closeProcModal);
  document.getElementById('proc-overlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeProcModal(); });
  document.getElementById('proc-form')?.addEventListener('submit', handleSaveProcedure);
}

// ---------- Load patients ----------
async function loadPatients() {
  showLoader(document.getElementById('patients-table-body'));

  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('name');

  if (error) {
    toast('Erro ao carregar pacientes', 'err');
    console.error(error);
    return;
  }

  patients = data || [];
  renderTable();
}

// ---------- Render table ----------
function renderTable() {
  const role = currentUser.profile.role;
  const tbody = document.getElementById('patients-table-body');
  const q = searchQuery.toLowerCase();

  const filtered = patients.filter(p =>
    p.name?.toLowerCase().includes(q) ||
    p.cpf?.includes(q) ||
    p.email?.toLowerCase().includes(q) ||
    p.phone?.includes(q)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * perPage;
  const page = filtered.slice(start, start + perPage);

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><p>Nenhum paciente encontrado</p></div></td></tr>`;
  } else {
    tbody.innerHTML = page.map(p => `
      <tr data-id="${p.id}" class="clickable-row">
        <td>
          <div class="p-cell">
            <div class="p-av" style="background:${avatarColor(p.name)}">${getInitials(p.name)}</div>
            <div>
              <div class="p-name">${p.name}</div>
              <div class="p-sub">${p.email || ''}</div>
            </div>
          </div>
        </td>
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

  // Action handlers
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'view') openDetail(id);
      else if (action === 'edit') openModal('edit', id);
      else if (action === 'delete') deletePatient(id);
    });
  });

  // Row click = view
  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => openDetail(row.dataset.id));
  });

  // Pagination
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
      ${Array.from({ length: totalPages }, (_, i) => `
        <button class="pg-btn ${i + 1 === currentPage ? 'active' : ''}" data-pg="${i + 1}">${i + 1}</button>
      `).join('')}
      <button class="pg-btn" ${currentPage === totalPages ? 'disabled' : ''} data-pg="${currentPage + 1}">${Icons.chevR}</button>
    </div>
  `;

  pg.querySelectorAll('[data-pg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.pg);
      if (p >= 1 && p <= totalPages) { currentPage = p; renderTable(); }
    });
  });
}

// ---------- Modal CRUD ----------
function openModal(mode, id = null) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('patient-form');

  form.reset();
  form.dataset.mode = mode;
  form.dataset.patientId = id || '';

  if (mode === 'edit' && id) {
    title.textContent = 'Editar Paciente';
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
    title.textContent = 'Novo Paciente';
  }

  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const data = {
    name: fd.get('name'),
    cpf: fd.get('cpf'),
    birth_date: fd.get('birth_date') || null,
    phone: fd.get('phone'),
    is_whatsapp: form.querySelector('[name="is_whatsapp"]').checked,
    email: fd.get('email'),
    address: fd.get('address'),
    legal_guardian_name: fd.get('legal_guardian_name'),
    notes: fd.get('notes'),
  };

  if (!data.name) { toast('Nome é obrigatório', 'err'); return; }

  const mode = form.dataset.mode;

  if (mode === 'create') {
    const { error } = await supabase.from('patients').insert([data]);
    if (error) { toast('Erro ao cadastrar: ' + error.message, 'err'); return; }
    toast('Paciente cadastrado com sucesso!');
  } else {
    const id = form.dataset.patientId;
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('patients').update(data).eq('id', id);
    if (error) { toast('Erro ao atualizar: ' + error.message, 'err'); return; }
    toast('Paciente atualizado com sucesso!');
  }

  closeModal();
  await loadPatients();
}

async function deletePatient(id) {
  const p = patients.find(x => x.id === id);
  if (!p) return;
  if (!confirmAction(`Deseja realmente excluir ${p.name}?`)) return;

  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) { toast('Erro ao excluir: ' + error.message, 'err'); return; }
  toast('Paciente removido');
  await loadPatients();
}

// ---------- Detail panel ----------
async function openDetail(id) {
  selectedPatient = patients.find(x => x.id === id);
  if (!selectedPatient) return;

  const { data: history } = await supabase
    .from('appointments')
    .select('*, professionals(name), procedures_catalog(name), insurances(name)')
    .eq('patient_id', id)
    .order('appointment_date', { ascending: false });

  selectedHistory = history || [];

  // Set header
  const p = selectedPatient;
  document.getElementById('dp-avatar').style.background = avatarColor(p.name);
  document.getElementById('dp-avatar').textContent = getInitials(p.name);
  document.getElementById('dp-name').textContent = p.name;

  // Reset to info tab
  document.querySelectorAll('.dp-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.dp-tab[data-tab="info"]').classList.add('active');
  renderDetailContent('info');

  // Show proc button based on permission
  const btnProc = document.getElementById('btn-new-procedure');
  if (btnProc) {
    btnProc.style.display = can(currentUser.profile.role, 'create_procedure') ? '' : 'none';
  }

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
          <div class="dp-field"><label>Responsável Legal</label><p>${p.legal_guardian_name || '—'}</p></div>
        </div>
        ${p.notes ? `<div class="dp-field" style="margin-top:14px"><label>Observações</label><p>${p.notes}</p></div>` : ''}
      </div>
      <div>
        <h4 style="font-size:.88rem;font-weight:700;margin-bottom:14px">Resumo</h4>
        <div class="dp-field-grid">
          <div class="dp-field"><label>Total de Atendimentos</label><p>${selectedHistory.length}</p></div>
          <div class="dp-field"><label>Total Investido</label><p style="color:var(--p-400);font-weight:700">${fmtCurrency(selectedHistory.reduce((s, h) => s + (h.value || 0), 0))}</p></div>
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
            <span class="badge ${h.paid ? 'badge-green' : 'badge-orange'}">${h.paid ? 'Pago' : 'Pendente'}</span>
          </div>
          ${h.paid && h.payment_date ? `<div style="font-size:.72rem;color:var(--t3);margin-top:4px">Pago em ${fmtDate(h.payment_date)} • ${h.payment_method || ''}</div>` : ''}
          ${can(currentUser.profile.role, 'edit_procedure') ? `
            <div style="margin-top:8px;display:flex;gap:6px">
              <button class="btn btn-s btn-sm" data-edit-proc="${h.id}">${Icons.edit} Editar</button>
              ${can(currentUser.profile.role, 'delete_procedure') ? `<button class="btn btn-d btn-sm" data-del-proc="${h.id}">${Icons.trash} Excluir</button>` : ''}
            </div>
          ` : ''}
        </div>
      `).join('')}</div>`;

      // Edit/delete procedure handlers
      content.querySelectorAll('[data-edit-proc]').forEach(btn => {
        btn.addEventListener('click', () => openProcedureModal(btn.dataset.editProc));
      });
      content.querySelectorAll('[data-del-proc]').forEach(btn => {
        btn.addEventListener('click', () => deleteProcedure(btn.dataset.delProc));
      });
    }
  }
}

// ---------- Procedure Modal ----------
function openProcedureModal(procId = null) {
  const overlay = document.getElementById('proc-overlay');
  const title = document.getElementById('proc-modal-title');
  const form = document.getElementById('proc-form');
  form.reset();

  if (procId) {
    title.textContent = 'Editar Atendimento';
    form.dataset.mode = 'edit';
    form.dataset.procId = procId;
    const proc = selectedHistory.find(h => h.id === procId);
    if (proc) {
      form.querySelector('[name="professional"]').value = proc.professionals?.name || proc.professional || '';
      form.querySelector('[name="procedure_name"]').value = proc.procedures_catalog?.name || proc.procedure_name || '';
      form.querySelector('[name="date"]').value = proc.appointment_date || proc.date || '';
      form.querySelector('[name="time"]').value = proc.appointment_time || proc.time || '';
      form.querySelector('[name="insurance"]').value = proc.insurances?.name || proc.insurance || '';
      form.querySelector('[name="value"]').value = proc.value || '';
      form.querySelector('[name="paid"]').checked = proc.paid || false;
      form.querySelector('[name="payment_date"]').value = proc.payment_date || '';
      form.querySelector('[name="payment_method"]').value = proc.payment_method || '';
      form.querySelector('[name="situation"]').value = proc.status || proc.situation || 'Agendado';
      form.querySelector('[name="notes"]').value = proc.notes || '';
    }
  } else {
    title.textContent = 'Novo Atendimento';
    form.dataset.mode = 'create';
    form.dataset.procId = '';
    // Default date to today
    form.querySelector('[name="date"]').value = new Date().toISOString().split('T')[0];
  }

  overlay.classList.add('open');
}

function closeProcModal() {
  document.getElementById('proc-overlay').classList.remove('open');
}

async function handleSaveProcedure(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const data = {
    patient_id: selectedPatient.id,
    professional: fd.get('professional'),
    procedure_name: fd.get('procedure_name'),
    appointment_date: fd.get('date') || null,
    appointment_time: fd.get('time') || null,
    insurance: fd.get('insurance'),
    value: parseFloat(fd.get('value')) || 0,
    paid: form.querySelector('[name="paid"]').checked,
    payment_date: fd.get('payment_date') || null,
    payment_method: fd.get('payment_method'),
    status: fd.get('situation'),
    notes: fd.get('notes'),
  };

  if (!data.procedure_name) { toast('Procedimento é obrigatório', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('appointments').insert([data]);
    if (error) { toast('Erro ao criar: ' + error.message, 'err'); return; }
    toast('Atendimento registrado!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('appointments').update(data).eq('id', form.dataset.procId);
    if (error) { toast('Erro ao atualizar: ' + error.message, 'err'); return; }
    toast('Atendimento atualizado!');
  }

  closeProcModal();
  await openDetail(selectedPatient.id); // Refresh
}

async function deleteProcedure(procId) {
  if (!confirmAction('Deseja excluir este atendimento?')) return;
  const { error } = await supabase.from('appointments').delete().eq('id', procId);
  if (error) { toast('Erro ao excluir: ' + error.message, 'err'); return; }
  toast('Atendimento removido');
  await openDetail(selectedPatient.id);
}

// Init
init();
