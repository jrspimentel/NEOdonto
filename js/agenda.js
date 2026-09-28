// js/agenda.js — Agenda module (complete rewrite)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;
let activeFilter = 'all';
let appointments = [];
let deleteTargetId = null;

// Lookup caches
let professionals = [];
let proceduresCatalog = [];
let insurancesList = [];

const STATUS_OPTIONS = [
  'Agendado', 'Paciente na recepção', 'Em atendimento',
  'Finalizado', 'Faltou', 'Cancelado', 'Reagendado'
];

// ========== Init ==========
async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (!can(currentUser.profile.role, 'view_agenda')) {
    window.location.href = '../index.html';
    return;
  }

  initLayout(currentUser, 'agenda');
  setTodayDates();
  setupEvents();
  await loadLookups();
  await loadAgenda();
}

function setTodayDates() {
  const today = fmtDateISO(new Date());
  document.getElementById('date-start').value = today;
  document.getElementById('date-end').value = today;
}

function setupEvents() {
  // Date range changes
  document.getElementById('date-start').addEventListener('change', onDateChange);
  document.getElementById('date-end').addEventListener('change', onDateChange);

  // Today button
  document.getElementById('btn-today').addEventListener('click', () => {
    setTodayDates();
    loadAgenda();
  });

  // Status filter tabs
  document.querySelectorAll('.tab[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-filter]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderTable();
    });
  });

  // New appointment button
  const btnNew = document.getElementById('btn-new-appointment');
  if (btnNew) {
    if (can(currentUser.profile.role, 'create_appointment')) {
      btnNew.addEventListener('click', () => openModal('create'));
    } else {
      btnNew.style.display = 'none';
    }
  }

  // Appointment modal
  document.getElementById('ag-modal-close').addEventListener('click', closeModal);
  document.getElementById('ag-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('ag-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('ag-form').addEventListener('submit', handleSave);

  // Delete modal
  document.getElementById('del-modal-close').addEventListener('click', closeDeleteModal);
  document.getElementById('del-cancel').addEventListener('click', closeDeleteModal);
  document.getElementById('del-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });
  document.getElementById('del-confirm').addEventListener('click', confirmDelete);
}

function onDateChange() {
  const s = document.getElementById('date-start').value;
  const e = document.getElementById('date-end').value;
  if (s && e && s > e) {
    toast('Data inicial não pode ser maior que data final', 'err');
    return;
  }
  loadAgenda();
}

// ========== Lookup data ==========
async function loadLookups() {
  const [profRes, procRes, insRes] = await Promise.all([
    supabase.from('professionals').select('id, name').order('name'),
    supabase.from('procedures_catalog').select('id, name').order('name'),
    supabase.from('insurances').select('id, name').order('name'),
  ]);
  professionals = profRes.data || [];
  proceduresCatalog = procRes.data || [];
  insurancesList = insRes.data || [];
}

// ========== Load appointments ==========
async function loadAgenda() {
  const tbody = document.getElementById('agenda-tbody');
  showLoader(tbody);

  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  if (!ds || !de) return;

  const { data, error } = await supabase
    .from('appointments')
    .select('*, professionals(name), patients(name), procedures_catalog(name), insurances(name)')
    .gte('appointment_date', ds)
    .lte('appointment_date', de)
    .order('appointment_date')
    .order('appointment_time');

  if (error) {
    toast('Erro ao carregar agenda', 'err');
    console.error(error);
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><p>Erro ao carregar agenda</p></div></td></tr>';
    return;
  }

  appointments = (data || []).map(a => ({
    ...a,
    professional_name: a.professionals?.name || '—',
    patient_name: a.patients?.name || '—',
    procedure_name: a.procedures_catalog?.name || '—',
    insurance_name: a.insurances?.name || '—',
  }));

  renderTable();
}

// ========== Render ==========
function renderTable() {
  const role = currentUser.profile.role;
  const canChangeStatus = can(role, 'change_status');
  const canEdit = can(role, 'edit_appointment');
  const canDelete = can(role, 'delete_appointment');

  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  const isMultiDay = ds !== de;

  // Dynamic thead
  const thead = document.getElementById('agenda-thead');
  const cols = isMultiDay
    ? ['Data', 'Profissional', 'Paciente', 'Procedimento', 'Convênio', 'Hora', 'Status', 'Ações']
    : ['Profissional', 'Paciente', 'Procedimento', 'Convênio', 'Hora', 'Status', 'Ações'];
  thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
  const colCount = cols.length;

  const tbody = document.getElementById('agenda-tbody');

  // Filter by status
  let filtered = appointments;
  if (activeFilter !== 'all') {
    const map = {
      agendados: 'Agendado',
      recepcao: 'Paciente na recepção',
      atendimento: 'Em atendimento',
      finalizados: 'Finalizado',
      faltou: 'Faltou',
      cancelados: 'Cancelado',
      reagendados: 'Reagendado',
    };
    const target = map[activeFilter];
    if (target) filtered = appointments.filter(a => a.status === target);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty"><p>Nenhum agendamento encontrado para o período selecionado</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => `
    <tr data-id="${a.id}">
      ${isMultiDay ? `<td>${fmtDate(a.appointment_date)}</td>` : ''}
      <td>${a.professional_name}</td>
      <td>${a.patient_name}</td>
      <td>${a.procedure_name}</td>
      <td>${a.insurance_name}</td>
      <td>${a.appointment_time || '—'}</td>
      <td>
        ${canChangeStatus
          ? `<select class="inline-select" data-field="status" data-id="${a.id}">
              ${STATUS_OPTIONS.map(o => `<option ${a.status === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>`
          : `<span class="badge ${statusBadge(a.status)}">${a.status || '—'}</span>`
        }
      </td>
      <td>
        <div style="display:flex;gap:4px">
          ${canEdit ? `<button class="btn-icon" title="Editar" data-action="edit" data-id="${a.id}">${Icons.edit}</button>` : ''}
          ${canDelete ? `<button class="btn-icon danger" title="Excluir" data-action="delete" data-id="${a.id}">${Icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  // Inline status change
  tbody.querySelectorAll('.inline-select').forEach(sel => {
    const orig = sel.value;
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      const val = sel.value;
      const { error } = await supabase
        .from('appointments')
        .update({ status: val, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        toast('Erro ao alterar status: ' + error.message, 'err');
        sel.value = orig;
        return;
      }
      const appt = appointments.find(x => x.id === id);
      if (appt) appt.status = val;
      toast('Status atualizado!');
    });
  });

  // Action buttons
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') openModal('edit', id);
      else if (btn.dataset.action === 'delete') openDeleteModal(id);
    });
  });
}

function statusBadge(s) {
  return {
    'Agendado': 'badge-blue', 'Paciente na recepção': 'badge-orange',
    'Em atendimento': 'badge-purple', 'Finalizado': 'badge-green',
    'Faltou': 'badge-red', 'Cancelado': 'badge-gray', 'Reagendado': 'badge-blue',
  }[s] || 'badge-gray';
}

// ========== Appointment Modal ==========
async function openModal(mode, id = null) {
  const overlay = document.getElementById('ag-overlay');
  const title = document.getElementById('ag-modal-title');
  const form = document.getElementById('ag-form');
  form.reset();
  form.dataset.mode = mode;
  form.dataset.apptId = id || '';

  // Populate selects from lookup cache
  fillSelect(form.querySelector('[name="professional_id"]'), professionals);
  fillSelect(form.querySelector('[name="procedure_id"]'), proceduresCatalog);
  fillSelect(form.querySelector('[name="insurance_id"]'), insurancesList);

  // Patients — load fresh
  const patSel = form.querySelector('[name="patient_id"]');
  const { data: pts } = await supabase.from('patients').select('id, name').order('name');
  fillSelect(patSel, pts || []);

  if (mode === 'edit' && id) {
    title.textContent = 'Editar Agendamento';
    const a = appointments.find(x => x.id === id);
    if (a) {
      form.querySelector('[name="professional_id"]').value = a.professional_id || '';
      patSel.value = a.patient_id || '';
      form.querySelector('[name="procedure_id"]').value = a.procedure_id || '';
      form.querySelector('[name="insurance_id"]').value = a.insurance_id || '';
      form.querySelector('[name="appointment_date"]').value = a.appointment_date || '';
      form.querySelector('[name="appointment_time"]').value = a.appointment_time || '';
      form.querySelector('[name="status"]').value = a.status || 'Agendado';
      form.querySelector('[name="notes"]').value = a.notes || '';
    }
  } else {
    title.textContent = 'Novo Agendamento';
    form.querySelector('[name="appointment_date"]').value = fmtDateISO(new Date());
  }

  overlay.classList.add('open');
}

function fillSelect(sel, items) {
  sel.innerHTML = '<option value="">Selecione...</option>';
  items.forEach(i => {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = i.name;
    sel.appendChild(opt);
  });
}

function closeModal() {
  document.getElementById('ag-overlay').classList.remove('open');
}

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const data = {
    professional_id: fd.get('professional_id') || null,
    patient_id: fd.get('patient_id') || null,
    procedure_id: fd.get('procedure_id') || null,
    insurance_id: fd.get('insurance_id') || null,
    appointment_date: fd.get('appointment_date'),
    appointment_time: fd.get('appointment_time'),
    status: fd.get('status'),
    notes: fd.get('notes'),
  };

  // Validations
  if (!data.professional_id) { toast('Selecione um profissional', 'err'); return; }
  if (!data.patient_id) { toast('Selecione um paciente', 'err'); return; }
  if (!data.procedure_id) { toast('Selecione um procedimento', 'err'); return; }
  if (!data.insurance_id) { toast('Selecione um convênio', 'err'); return; }
  if (!data.appointment_date) { toast('Data é obrigatória', 'err'); return; }
  if (!data.appointment_time) { toast('Hora é obrigatória', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('appointments').insert([data]);
    if (error) { toast('Erro ao criar: ' + error.message, 'err'); return; }
    toast('Agendamento criado com sucesso!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('appointments').update(data).eq('id', form.dataset.apptId);
    if (error) { toast('Erro ao atualizar: ' + error.message, 'err'); return; }
    toast('Agendamento atualizado com sucesso!');
  }

  closeModal();
  await loadAgenda();
}

// ========== Delete Modal ==========
function openDeleteModal(id) {
  deleteTargetId = id;
  document.getElementById('del-overlay').classList.add('open');
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('del-overlay').classList.remove('open');
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  const { error } = await supabase.from('appointments').delete().eq('id', deleteTargetId);
  if (error) {
    toast('Erro ao excluir: ' + error.message, 'err');
  } else {
    toast('Agendamento excluído com sucesso!');
    await loadAgenda();
  }
  closeDeleteModal();
}

// Init
init();
