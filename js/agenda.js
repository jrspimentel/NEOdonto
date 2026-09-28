// js/agenda.js — Agenda + Payments (integrated rewrite)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtDateISO, fmtCurrency, toast, showLoader } from './layout.js';

let currentUser = null;
let activeFilter = 'all';
let appointments = [];
let deleteTargetId = null;
let payTargetAppt = null;

// Lookup caches
let professionals = [];
let proceduresCatalog = [];
let insurancesList = [];

const STATUS_OPTIONS = ['Agendado','Paciente na recepção','Em atendimento','Finalizado','Faltou','Cancelado','Reagendado'];

// ========== Init ==========
async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  if (!can(currentUser.profile.role, 'view_agenda')) { window.location.href = '../index.html'; return; }

  initLayout(currentUser, 'agenda');
  setTodayDates();
  setupEvents();
  await loadLookups();
  await loadAgenda();
  setupRealtime();
}

function setTodayDates() {
  const today = fmtDateISO(new Date());
  document.getElementById('date-start').value = today;
  document.getElementById('date-end').value = today;
}

function setupEvents() {
  document.getElementById('date-start').addEventListener('change', onDateChange);
  document.getElementById('date-end').addEventListener('change', onDateChange);
  document.getElementById('btn-today').addEventListener('click', () => { setTodayDates(); loadAgenda(); });

  document.querySelectorAll('.tab[data-filter]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab[data-filter]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderTable();
    });
  });

  const btnNew = document.getElementById('btn-new-appointment');
  if (btnNew) {
    if (can(currentUser.profile.role, 'create_appointment')) {
      btnNew.addEventListener('click', () => openModal('create'));
    } else { btnNew.style.display = 'none'; }
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

  // Payment modal
  document.getElementById('pay-modal-close').addEventListener('click', closePayModal);
  document.getElementById('pay-modal-cancel').addEventListener('click', closePayModal);
  document.getElementById('pay-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closePayModal(); });
  document.getElementById('pay-form').addEventListener('submit', handlePayment);

  // Auto-calculate final amount
  ['pay-amount', 'discount', 'surcharge'].forEach(name => {
    const el = document.querySelector(`[name="${name === 'pay-amount' ? 'amount' : name}"]`);
    if (el) el.addEventListener('input', calcFinal);
  });
  document.querySelector('#pay-form [name="amount"]')?.addEventListener('input', calcFinal);
  document.querySelector('#pay-form [name="discount"]')?.addEventListener('input', calcFinal);
  document.querySelector('#pay-form [name="surcharge"]')?.addEventListener('input', calcFinal);
}

function calcFinal() {
  const form = document.getElementById('pay-form');
  const a = parseFloat(form.querySelector('[name="amount"]').value) || 0;
  const d = parseFloat(form.querySelector('[name="discount"]').value) || 0;
  const s = parseFloat(form.querySelector('[name="surcharge"]').value) || 0;
  const final = Math.max(0, a - d + s);
  document.getElementById('pay-final').value = final.toFixed(2);
}

function onDateChange() {
  const s = document.getElementById('date-start').value;
  const e = document.getElementById('date-end').value;
  if (s && e && s > e) { toast('Data inicial não pode ser maior que data final', 'err'); return; }
  loadAgenda();
}

// ========== Realtime ==========
function setupRealtime() {
  supabase.channel('appointments-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
      loadAgenda();
    })
    .subscribe();
}

// ========== Lookups ==========
async function loadLookups() {
  const [profRes, procRes, insRes] = await Promise.all([
    supabase.from('professionals').select('id, name').order('name'),
    supabase.from('procedures_catalog').select('id, name, default_value').order('name'),
    supabase.from('insurances').select('id, name').order('name'),
  ]);
  professionals = profRes.data || [];
  proceduresCatalog = procRes.data || [];
  insurancesList = insRes.data || [];
}

// ========== Load ==========
async function loadAgenda() {
  const tbody = document.getElementById('agenda-tbody');
  showLoader(tbody);

  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  if (!ds || !de) return;

  // Load appointments + payment summary
  const { data, error } = await supabase
    .from('appointments')
    .select('*, professionals(name), patients(name), procedures_catalog(name), insurances(name)')
    .gte('appointment_date', ds).lte('appointment_date', de)
    .order('appointment_date').order('appointment_time');

  if (error) { toast('Erro ao carregar agenda', 'err'); console.error(error); return; }

  // Load payment summaries for these appointments
  const ids = (data || []).map(a => a.id);
  let paySummaries = {};
  if (ids.length > 0) {
    const { data: pays } = await supabase
      .from('payments')
      .select('appointment_id, final_amount, payment_status')
      .in('appointment_id', ids);
    (pays || []).forEach(p => {
      if (!paySummaries[p.appointment_id]) paySummaries[p.appointment_id] = { paid: 0, status: 'Pendente' };
      if (p.payment_status === 'Pago' || p.payment_status === 'Parcialmente pago') {
        paySummaries[p.appointment_id].paid += (p.final_amount || 0);
      }
    });
    // Determine overall payment status
    Object.keys(paySummaries).forEach(aid => {
      const appt = data.find(a => a.id === aid);
      const total = appt?.value || 0;
      const paid = paySummaries[aid].paid;
      if (paid >= total && total > 0) paySummaries[aid].status = 'Pago';
      else if (paid > 0) paySummaries[aid].status = 'Parcial';
      else paySummaries[aid].status = 'Pendente';
    });
  }

  appointments = (data || []).map(a => ({
    ...a,
    professional_name: a.professionals?.name || '—',
    patient_name: a.patients?.name || '—',
    procedure_name: a.procedures_catalog?.name || '—',
    insurance_name: a.insurances?.name || '—',
    pay_summary: paySummaries[a.id] || { paid: 0, status: 'Pendente' },
  }));

  renderTable();
}

// ========== Render ==========
function renderTable() {
  const role = currentUser.profile.role;
  const canChangeStatus = can(role, 'change_status');
  const canEdit = can(role, 'edit_appointment');
  const canDelete = can(role, 'delete_appointment');
  const canPay = can(role, 'create_payment');

  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  const isMultiDay = ds !== de;

  const thead = document.getElementById('agenda-thead');
  const cols = isMultiDay
    ? ['Data','Profissional','Paciente','Procedimento','Convênio','Hora','Status','Pgto','Ações']
    : ['Profissional','Paciente','Procedimento','Convênio','Hora','Status','Pgto','Ações'];
  thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
  const colCount = cols.length;
  const tbody = document.getElementById('agenda-tbody');

  let filtered = appointments;
  if (activeFilter !== 'all') {
    const map = { agendados:'Agendado', recepcao:'Paciente na recepção', atendimento:'Em atendimento', finalizados:'Finalizado', faltou:'Faltou', cancelados:'Cancelado', reagendados:'Reagendado' };
    const target = map[activeFilter];
    if (target) filtered = appointments.filter(a => a.status === target);
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty"><p>Nenhum agendamento encontrado para o período selecionado</p></div></td></tr>`;
    return;
  }

  const payBadge = (s) => ({ 'Pago':'<span class="badge badge-green" title="Pago">💰</span>', 'Parcial':'<span class="badge badge-orange" title="Parcialmente pago">◐</span>', 'Pendente':'<span class="badge badge-gray" title="Pendente">🟡</span>' }[s] || '<span class="badge badge-gray">—</span>');

  tbody.innerHTML = filtered.map(a => `
    <tr data-id="${a.id}">
      ${isMultiDay ? `<td>${fmtDate(a.appointment_date)}</td>` : ''}
      <td>${a.professional_name}</td>
      <td>${a.patient_name}</td>
      <td>${a.procedure_name}</td>
      <td>${a.insurance_name}</td>
      <td>${a.appointment_time || '—'}</td>
      <td>${canChangeStatus
        ? `<select class="inline-select" data-field="status" data-id="${a.id}">${STATUS_OPTIONS.map(o => `<option ${a.status===o?'selected':''}>${o}</option>`).join('')}</select>`
        : `<span class="badge ${statusBadge(a.status)}">${a.status||'—'}</span>`}</td>
      <td>${payBadge(a.pay_summary.status)}</td>
      <td>
        <div style="display:flex;gap:4px">
          ${canEdit ? `<button class="btn-icon" title="Editar" data-action="edit" data-id="${a.id}">${Icons.edit}</button>` : ''}
          ${canPay ? `<button class="btn-icon" title="Pagamento" data-action="pay" data-id="${a.id}">${Icons.money}</button>` : ''}
          ${canDelete ? `<button class="btn-icon danger" title="Excluir" data-action="delete" data-id="${a.id}">${Icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  // Inline status change
  tbody.querySelectorAll('.inline-select').forEach(sel => {
    const orig = sel.value;
    sel.addEventListener('change', async () => {
      const { error } = await supabase.from('appointments').update({ status: sel.value, updated_at: new Date().toISOString() }).eq('id', sel.dataset.id);
      if (error) { toast('Erro: ' + error.message, 'err'); sel.value = orig; return; }
      const a = appointments.find(x => x.id === sel.dataset.id); if (a) a.status = sel.value;
      toast('Status atualizado!');
    });
  });

  // Action buttons
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit') openModal('edit', id);
      else if (btn.dataset.action === 'delete') openDeleteModal(id);
      else if (btn.dataset.action === 'pay') openPayModal(id);
    });
  });
}

function statusBadge(s) {
  return { 'Agendado':'badge-blue','Paciente na recepção':'badge-orange','Em atendimento':'badge-purple','Finalizado':'badge-green','Faltou':'badge-red','Cancelado':'badge-gray','Reagendado':'badge-blue' }[s] || 'badge-gray';
}

// ========== Appointment Modal ==========
async function openModal(mode, id = null) {
  const form = document.getElementById('ag-form');
  form.reset(); form.dataset.mode = mode; form.dataset.apptId = id || '';

  fillSelect(form.querySelector('[name="professional_id"]'), professionals);
  fillSelect(form.querySelector('[name="procedure_id"]'), proceduresCatalog);
  fillSelect(form.querySelector('[name="insurance_id"]'), insurancesList);
  const patSel = form.querySelector('[name="patient_id"]');
  const { data: pts } = await supabase.from('patients').select('id, name').order('name');
  fillSelect(patSel, pts || []);

  // Auto-fill value when procedure changes
  form.querySelector('[name="procedure_id"]').addEventListener('change', function() {
    const proc = proceduresCatalog.find(p => p.id === this.value);
    if (proc && proc.default_value) form.querySelector('[name="value"]').value = proc.default_value;
  });

  if (mode === 'edit' && id) {
    document.getElementById('ag-modal-title').textContent = 'Editar Agendamento';
    const a = appointments.find(x => x.id === id);
    if (a) {
      form.querySelector('[name="professional_id"]').value = a.professional_id || '';
      patSel.value = a.patient_id || '';
      form.querySelector('[name="procedure_id"]').value = a.procedure_id || '';
      form.querySelector('[name="insurance_id"]').value = a.insurance_id || '';
      form.querySelector('[name="appointment_date"]').value = a.appointment_date || '';
      form.querySelector('[name="appointment_time"]').value = a.appointment_time || '';
      form.querySelector('[name="value"]').value = a.value || '';
      form.querySelector('[name="status"]').value = a.status || 'Agendado';
      form.querySelector('[name="notes"]').value = a.notes || '';
    }
  } else {
    document.getElementById('ag-modal-title').textContent = 'Novo Agendamento';
    form.querySelector('[name="appointment_date"]').value = fmtDateISO(new Date());
  }
  document.getElementById('ag-overlay').classList.add('open');
}

function fillSelect(sel, items) {
  sel.innerHTML = '<option value="">Selecione...</option>';
  items.forEach(i => { const o = document.createElement('option'); o.value = i.id; o.textContent = i.name; sel.appendChild(o); });
}

function closeModal() { document.getElementById('ag-overlay').classList.remove('open'); }

async function handleSave(e) {
  e.preventDefault();
  const form = e.target; const fd = new FormData(form);
  const data = {
    professional_id: fd.get('professional_id') || null,
    patient_id: fd.get('patient_id') || null,
    procedure_id: fd.get('procedure_id') || null,
    insurance_id: fd.get('insurance_id') || null,
    appointment_date: fd.get('appointment_date'),
    appointment_time: fd.get('appointment_time'),
    value: parseFloat(fd.get('value')) || 0,
    status: fd.get('status'),
    notes: fd.get('notes'),
  };

  if (!data.professional_id) { toast('Selecione um profissional', 'err'); return; }
  if (!data.patient_id) { toast('Selecione um paciente', 'err'); return; }
  if (!data.procedure_id) { toast('Selecione um procedimento', 'err'); return; }
  if (!data.insurance_id) { toast('Selecione um convênio', 'err'); return; }
  if (!data.appointment_date) { toast('Data é obrigatória', 'err'); return; }
  if (!data.appointment_time) { toast('Hora é obrigatória', 'err'); return; }

  if (form.dataset.mode === 'create') {
    const { error } = await supabase.from('appointments').insert([data]);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Agendamento criado com sucesso!');
  } else {
    data.updated_at = new Date().toISOString();
    const { error } = await supabase.from('appointments').update(data).eq('id', form.dataset.apptId);
    if (error) { toast('Erro: ' + error.message, 'err'); return; }
    toast('Agendamento atualizado!');
  }
  closeModal(); await loadAgenda();
}

// ========== Delete Modal ==========
function openDeleteModal(id) { deleteTargetId = id; document.getElementById('del-overlay').classList.add('open'); }
function closeDeleteModal() { deleteTargetId = null; document.getElementById('del-overlay').classList.remove('open'); }
async function confirmDelete() {
  if (!deleteTargetId) return;
  const { error } = await supabase.from('appointments').delete().eq('id', deleteTargetId);
  if (error) toast('Erro: ' + error.message, 'err');
  else { toast('Agendamento excluído!'); await loadAgenda(); }
  closeDeleteModal();
}

// ========== Payment Modal ==========
async function openPayModal(apptId) {
  const a = appointments.find(x => x.id === apptId);
  if (!a) return;
  payTargetAppt = a;

  const form = document.getElementById('pay-form');
  form.reset();

  // Show appointment info
  document.getElementById('pay-info').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm)">
      <div><small style="color:var(--t3)">Paciente</small><div style="font-weight:600">${a.patient_name}</div></div>
      <div><small style="color:var(--t3)">Procedimento</small><div style="font-weight:600">${a.procedure_name}</div></div>
      <div><small style="color:var(--t3)">Valor do procedimento</small><div style="font-weight:600;color:var(--p-400)">${fmtCurrency(a.value || 0)}</div></div>
      <div><small style="color:var(--t3)">Já pago</small><div style="font-weight:600;color:var(--success)">${fmtCurrency(a.pay_summary.paid)}</div></div>
    </div>
  `;

  // Set default values
  const remaining = Math.max(0, (a.value || 0) - a.pay_summary.paid);
  form.querySelector('[name="amount"]').value = remaining.toFixed(2);
  form.querySelector('[name="discount"]').value = '0';
  form.querySelector('[name="surcharge"]').value = '0';
  calcFinal();

  // Load payment history
  const { data: history } = await supabase.from('payments')
    .select('*, profiles(name)').eq('appointment_id', apptId).order('created_at', { ascending: false });

  const histDiv = document.getElementById('pay-history');
  if (history && history.length > 0) {
    histDiv.innerHTML = `
      <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px">Histórico de pagamentos</h4>
      <div class="timeline">${history.map(h => `
        <div class="tl-item" style="padding:8px 0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-weight:600;color:var(--p-400)">${fmtCurrency(h.final_amount)}</span>
            <span class="badge ${h.payment_status === 'Pago' ? 'badge-green' : h.payment_status === 'Cancelado' ? 'badge-gray' : 'badge-orange'}">${h.payment_status}</span>
          </div>
          <div style="font-size:.75rem;color:var(--t3);margin-top:4px">
            ${h.payment_method} • ${h.paid_at ? fmtDate(h.paid_at.split('T')[0]) : '—'}
            ${h.profiles?.name ? ' • por ' + h.profiles.name : ''}
          </div>
          ${h.notes ? `<div style="font-size:.75rem;color:var(--t2);margin-top:2px">${h.notes}</div>` : ''}
        </div>
      `).join('')}</div>
    `;
  } else {
    histDiv.innerHTML = '';
  }

  document.getElementById('pay-overlay').classList.add('open');
}

function closePayModal() { payTargetAppt = null; document.getElementById('pay-overlay').classList.remove('open'); }

async function handlePayment(e) {
  e.preventDefault();
  if (!payTargetAppt) return;
  const form = e.target; const fd = new FormData(form);

  const amount = parseFloat(fd.get('amount')) || 0;
  const discount = parseFloat(fd.get('discount')) || 0;
  const surcharge = parseFloat(fd.get('surcharge')) || 0;
  const finalAmount = Math.max(0, amount - discount + surcharge);

  if (finalAmount <= 0) { toast('Valor inválido', 'err'); return; }
  if (discount > amount) { toast('Desconto não pode ser maior que o valor', 'err'); return; }

  const data = {
    appointment_id: payTargetAppt.id,
    patient_id: payTargetAppt.patient_id,
    amount,
    discount,
    surcharge,
    final_amount: finalAmount,
    payment_method: fd.get('payment_method'),
    payment_status: fd.get('payment_status'),
    paid_at: new Date().toISOString(),
    notes: fd.get('pay_notes'),
    created_by: currentUser.profile.id || currentUser.id,
  };

  const { error } = await supabase.from('payments').insert([data]);
  if (error) { toast('Erro ao registrar pagamento: ' + error.message, 'err'); return; }

  toast('Pagamento registrado com sucesso!');
  closePayModal();
  await loadAgenda();
}

init();
