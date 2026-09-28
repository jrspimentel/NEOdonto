// js/agenda.js — Agenda do Dia page logic
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtDateISO, fmtCurrency, toast, confirmAction, showLoader } from './layout.js';

let currentUser = null;
let selectedDate = new Date();
let activeFilter = 'all';
let appointments = [];

const STATUS_OPTIONS = ['Agendado', 'Realizado', 'Faltou', 'Cancelado'];
const SITUATION_OPTIONS = ['Agendado', 'Paciente na recepção', 'Em atendimento', 'Finalizado', 'Cancelado'];

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (!can(currentUser.profile.role, 'view_agenda')) {
    window.location.href = '../index.html';
    return;
  }

  initLayout(currentUser, 'agenda');
  setupEvents();
  await loadAgenda();
}

function setupEvents() {
  // Date navigation
  document.getElementById('btn-prev-day').addEventListener('click', () => changeDay(-1));
  document.getElementById('btn-next-day').addEventListener('click', () => changeDay(1));
  document.getElementById('btn-today').addEventListener('click', () => { selectedDate = new Date(); loadAgenda(); });
  document.getElementById('date-picker').addEventListener('change', e => {
    selectedDate = new Date(e.target.value + 'T12:00:00');
    loadAgenda();
  });

  // Filters
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

  // Modal
  document.getElementById('ag-modal-close').addEventListener('click', closeModal);
  document.getElementById('ag-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('ag-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('ag-form').addEventListener('submit', handleSave);
}

function changeDay(delta) {
  selectedDate.setDate(selectedDate.getDate() + delta);
  loadAgenda();
}

function updateDateDisplay() {
  const display = document.getElementById('date-display');
  display.textContent = selectedDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  display.style.textTransform = 'capitalize';
  document.getElementById('date-picker').value = fmtDateISO(selectedDate);
}

// ---------- Load data ----------
async function loadAgenda() {
  updateDateDisplay();
  const tbody = document.getElementById('agenda-tbody');
  showLoader(tbody);

  const dateStr = fmtDateISO(selectedDate);

  const { data, error } = await supabase
    .from('procedures')
    .select('*, patients(name)')
    .eq('date', dateStr)
    .order('time');

  if (error) {
    toast('Erro ao carregar agenda', 'err');
    console.error(error);
    return;
  }

  appointments = (data || []).map(a => ({
    ...a,
    patient_name: a.patients?.name || '—'
  }));

  renderTable();
}

// ---------- Render ----------
function renderTable() {
  const role = currentUser.profile.role;
  const canChangeStatus = can(role, 'change_status');
  const canChangeSituation = can(role, 'change_situation');
  const canEdit = can(role, 'edit_appointment');
  const canCancel = can(role, 'cancel_appointment');

  const tbody = document.getElementById('agenda-tbody');

  // Filter
  let filtered = appointments;
  if (activeFilter !== 'all') {
    const filterMap = {
      agendados: a => a.situation === 'Agendado',
      recepcao: a => a.situation === 'Paciente na recepção',
      atendimento: a => a.situation === 'Em atendimento',
      realizados: a => a.status === 'Realizado',
      faltou: a => a.status === 'Faltou',
      cancelados: a => a.status === 'Cancelado',
    };
    const fn = filterMap[activeFilter];
    if (fn) filtered = appointments.filter(fn);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><p>Nenhum atendimento${activeFilter !== 'all' ? ' com este filtro' : ' para este dia'}</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(a => `
    <tr data-id="${a.id}">
      <td>${a.professional || '—'}</td>
      <td>${a.patient_name}</td>
      <td>${a.procedure_name || '—'}</td>
      <td>${a.insurance || 'Particular'}</td>
      <td>${a.time || '—'}</td>
      <td>
        ${canChangeStatus
          ? `<select class="inline-select" data-field="status" data-id="${a.id}">
              ${STATUS_OPTIONS.map(o => `<option ${a.status === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>`
          : `<span class="badge ${statusBadge(a.status)}">${a.status || '—'}</span>`
        }
      </td>
      <td>
        ${canChangeSituation
          ? `<select class="inline-select" data-field="situation" data-id="${a.id}">
              ${SITUATION_OPTIONS.map(o => `<option ${a.situation === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>`
          : `<span class="badge ${situationBadge(a.situation)}">${a.situation || '—'}</span>`
        }
      </td>
      <td>
        <div style="display:flex;gap:4px">
          ${canEdit ? `<button class="btn-icon" title="Editar" data-action="edit" data-id="${a.id}">${Icons.edit}</button>` : ''}
          ${canCancel ? `<button class="btn-icon danger" title="Cancelar" data-action="cancel" data-id="${a.id}">${Icons.close}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  // Inline status/situation change
  tbody.querySelectorAll('.inline-select').forEach(sel => {
    const originalValue = sel.value;
    sel.addEventListener('change', async () => {
      const field = sel.dataset.field;
      const id = sel.dataset.id;
      const newValue = sel.value;

      const { error } = await supabase
        .from('procedures')
        .update({ [field]: newValue, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) {
        toast(`Erro ao alterar ${field}: ${error.message}`, 'err');
        sel.value = originalValue; // Restore
        return;
      }

      // Update local data
      const appt = appointments.find(a => a.id === id);
      if (appt) appt[field] = newValue;

      toast(`${field === 'status' ? 'Status' : 'Situação'} atualizado(a)!`);
    });
  });

  // Action buttons
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') openModal('edit', id);
      else if (btn.dataset.action === 'cancel') cancelAppointment(id);
    });
  });
}

function statusBadge(s) {
  return { 'Realizado': 'badge-green', 'Faltou': 'badge-red', 'Cancelado': 'badge-gray', 'Agendado': 'badge-blue' }[s] || 'badge-gray';
}

function situationBadge(s) {
  return { 'Finalizado': 'badge-green', 'Em atendimento': 'badge-purple', 'Paciente na recepção': 'badge-orange', 'Cancelado': 'badge-gray', 'Agendado': 'badge-blue' }[s] || 'badge-gray';
}

// ---------- Modal ----------
async function openModal(mode, id = null) {
  const overlay = document.getElementById('ag-overlay');
  const title = document.getElementById('ag-modal-title');
  const form = document.getElementById('ag-form');
  form.reset();
  form.dataset.mode = mode;
  form.dataset.apptId = id || '';

  // Load patients for dropdown
  const patientSelect = form.querySelector('[name="patient_id"]');
  if (patientSelect.options.length <= 1) {
    const { data: pts } = await supabase.from('patients').select('id, name').order('name');
    (pts || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      patientSelect.appendChild(opt);
    });
  }

  if (mode === 'edit' && id) {
    title.textContent = 'Editar Agendamento';
    const a = appointments.find(x => x.id === id);
    if (a) {
      patientSelect.value = a.patient_id || '';
      form.querySelector('[name="professional"]').value = a.professional || '';
      form.querySelector('[name="procedure_name"]').value = a.procedure_name || '';
      form.querySelector('[name="date"]').value = a.date || '';
      form.querySelector('[name="time"]').value = a.time || '';
      form.querySelector('[name="insurance"]').value = a.insurance || '';
      form.querySelector('[name="value"]').value = a.value || '';
      form.querySelector('[name="status"]').value = a.status || 'Agendado';
      form.querySelector('[name="situation"]').value = a.situation || 'Agendado';
      form.querySelector('[name="notes"]').value = a.notes || '';
    }
  } else {
    title.textContent = 'Novo Agendamento';
    form.querySelector('[name="date"]').value = fmtDateISO(selectedDate);
  }

  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('ag-overlay').classList.remove('open');
}

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const data = {
    patient_id: fd.get('patient_id'),
    professional: fd.get('professional'),
    procedure_name: fd.get('procedure_name'),
    date: fd.get('date') || null,
    time: fd.get('time') || null,
    insurance: fd.get('insurance'),
    value: parseFloat(fd.get('value')) || 0,
    status: fd.get('status'),
    situation: fd.get('situation'),
    notes: fd.get('notes'),
  };

  if (!data.patient_id) { toast('Selecione um paciente', 'err'); return; }
  if (!data.procedure_name) { toast('Procedimento é obrigatório', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('procedures').insert([data]);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Agendamento criado!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('procedures').update(data).eq('id', form.dataset.apptId);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Agendamento atualizado!');
  }

  closeModal();
  await loadAgenda();
}

async function cancelAppointment(id) {
  if (!confirmAction('Deseja cancelar este agendamento?')) return;

  const { error } = await supabase
    .from('procedures')
    .update({ status: 'Cancelado', situation: 'Cancelado', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { toast('Erro: ' + error.message, 'err'); return; }
  toast('Agendamento cancelado');
  await loadAgenda();
}

// Init
init();
