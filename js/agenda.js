// js/agenda.js — Agenda + Payments (robust - no relational joins)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, fmtDate, fmtDateISO, fmtCurrency, toast } from './layout.js';

let currentUser = null;
let activeFilter = 'all';
let appointments = [];
let deleteTargetId = null;
let payTargetAppt = null;

// Lookup caches
let professionals = [];
let proceduresCatalog = [];
let insurancesList = [];
let patientsCache = [];

const STATUS_OPTIONS = ['Agendado','Paciente na recepção','Em atendimento','Finalizado','Faltou','Cancelado','Reagendado'];

// ========== Init ==========
async function init() {
  try {
    currentUser = await requireAuth();
    if (!currentUser) return;
    if (!can(currentUser.profile.role, 'view_agenda')) { window.location.href = '../index.html'; return; }

    initLayout(currentUser, 'agenda');
    setTodayDates();
    setupEvents();
    await loadLookups();
    await loadAgenda();
    setupRealtime();
  } catch(e) {
    console.error('Init error:', e);
    document.getElementById('agenda-tbody').innerHTML = `<tr><td colspan="8"><div class="empty"><p>Erro de inicialização: ${e.message}</p></div></td></tr>`;
  }
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
  const payForm = document.getElementById('pay-form');
  payForm.querySelector('[name="amount"]')?.addEventListener('input', calcFinal);
  payForm.querySelector('[name="discount"]')?.addEventListener('input', calcFinal);
  payForm.querySelector('[name="surcharge"]')?.addEventListener('input', calcFinal);
}

function calcFinal() {
  const form = document.getElementById('pay-form');
  const a = parseFloat(form.querySelector('[name="amount"]').value) || 0;
  const d = parseFloat(form.querySelector('[name="discount"]').value) || 0;
  const s = parseFloat(form.querySelector('[name="surcharge"]').value) || 0;
  document.getElementById('pay-final').value = Math.max(0, a - d + s).toFixed(2);
}

function onDateChange() {
  const s = document.getElementById('date-start').value;
  const e = document.getElementById('date-end').value;
  if (s && e && s > e) { toast('Data inicial não pode ser maior que data final', 'err'); return; }
  loadAgenda();
}

// ========== Realtime ==========
function setupRealtime() {
  try {
    supabase.channel('agenda-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadAgenda())
      .subscribe();
  } catch(e) { console.warn('Realtime:', e); }
}

// ========== Lookups ==========
async function loadLookups() {
  try {
    const { data: p1, error: e1 } = await supabase.from('professionals').select('id, name').order('name');
    if (e1) console.warn('professionals error:', e1.message);
    professionals = p1 || [];
  } catch(e) { console.warn('professionals failed:', e); }

  try {
    const { data: p2, error: e2 } = await supabase.from('procedures_catalog').select('id, name, default_value').order('name');
    if (e2) console.warn('procedures_catalog error:', e2.message);
    proceduresCatalog = p2 || [];
  } catch(e) { console.warn('procedures_catalog failed:', e); }

  try {
    const { data: p3, error: e3 } = await supabase.from('insurances').select('id, name').order('name');
    if (e3) console.warn('insurances error:', e3.message);
    insurancesList = p3 || [];
  } catch(e) { console.warn('insurances failed:', e); }

  console.log('[Lookups] professionals:', professionals.length, 'procedures:', proceduresCatalog.length, 'insurances:', insurancesList.length);
}

// ========== Load ==========
async function loadAgenda() {
  const tbody = document.getElementById('agenda-tbody');
  tbody.innerHTML = '<tr><td colspan="9"><div class="page-loader"><span class="spinner"></span> Carregando...</div></td></tr>';

  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  if (!ds || !de) return;

  try {
    // Step 1: Load raw appointments (no joins)
    const { data: rawAppts, error: apptErr } = await supabase
      .from('appointments')
      .select('*')
      .gte('appointment_date', ds).lte('appointment_date', de)
      .order('appointment_date').order('appointment_time');

    if (apptErr) {
      console.error('Appointments query error:', apptErr);
      tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><p>Erro: ${apptErr.message}</p></div></td></tr>`;
      return;
    }

    const data = rawAppts || [];

    // Step 2: Build lookup maps from cached data
    const profMap = {};
    professionals.forEach(p => profMap[p.id] = p.name);
    const procMap = {};
    proceduresCatalog.forEach(p => procMap[p.id] = p.name);
    const insMap = {};
    insurancesList.forEach(p => insMap[p.id] = p.name);

    // Step 3: Load patient names for this batch
    const patIds = [...new Set(data.filter(a => a.patient_id).map(a => a.patient_id))];
    const patMap = {};
    if (patIds.length > 0) {
      const { data: pats } = await supabase.from('patients').select('id, name').in('id', patIds);
      (pats || []).forEach(p => patMap[p.id] = p.name);
    }

    // Step 4: Load payment summaries
    const apptIds = data.map(a => a.id);
    let paySummaries = {};
    if (apptIds.length > 0) {
      try {
        const { data: pays } = await supabase.from('payments')
          .select('appointment_id, final_amount, payment_status')
          .in('appointment_id', apptIds);
        (pays || []).forEach(p => {
          if (!paySummaries[p.appointment_id]) paySummaries[p.appointment_id] = { paid: 0, status: 'Pendente' };
          if (p.payment_status === 'Pago' || p.payment_status === 'Parcialmente pago') {
            paySummaries[p.appointment_id].paid += (p.final_amount || 0);
          }
        });
        Object.keys(paySummaries).forEach(aid => {
          const appt = data.find(a => a.id === aid);
          const total = appt?.value || 0;
          const paid = paySummaries[aid].paid;
          if (paid >= total && total > 0) paySummaries[aid].status = 'Pago';
          else if (paid > 0) paySummaries[aid].status = 'Parcial';
        });
      } catch(e) { console.warn('Payments query failed:', e); }
    }

    // Step 5: Enrich appointments
    appointments = data.map(a => ({
      ...a,
      professional_name: profMap[a.professional_id] || '—',
      patient_name: patMap[a.patient_id] || '—',
      procedure_name: procMap[a.procedure_id] || '—',
      insurance_name: insMap[a.insurance_id] || '—',
      pay_summary: paySummaries[a.id] || { paid: 0, status: 'Pendente' },
    }));

    renderTable();
  } catch (err) {
    console.error('loadAgenda error:', err);
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><p>Erro: ${err.message || err}</p></div></td></tr>`;
  }
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
    tbody.innerHTML = `<tr><td colspan="${colCount}"><div class="empty"><p>Nenhum agendamento encontrado</p></div></td></tr>`;
    return;
  }

  const payBadge = (s) => {
    if (s === 'Pago') return '<span class="badge badge-green">Pago</span>';
    if (s === 'Parcial') return '<span class="badge badge-orange">Parcial</span>';
    return '<span class="badge badge-gray">—</span>';
  };

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
    sel.addEventListener('change', async () => {
      const origValue = sel.dataset.orig || sel.value;
      const { error } = await supabase.from('appointments').update({ status: sel.value, updated_at: new Date().toISOString() }).eq('id', sel.dataset.id);
      if (error) { toast('Erro ao alterar status: ' + error.message, 'err'); sel.value = origValue; return; }
      toast('Status atualizado!');
    });
    sel.dataset.orig = sel.value;
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

  // Load patients
  const patSel = form.querySelector('[name="patient_id"]');
  try {
    const { data: pts } = await supabase.from('patients').select('id, name').order('name');
    fillSelect(patSel, pts || []);
  } catch(e) {
    console.warn('Failed to load patients for form:', e);
    fillSelect(patSel, []);
  }

  // Auto-fill value when procedure changes
  const procSel = form.querySelector('[name="procedure_id"]');
  procSel.onchange = function() {
    const proc = proceduresCatalog.find(p => p.id === this.value);
    if (proc && proc.default_value) form.querySelector('[name="value"]').value = proc.default_value;
  };

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
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecione...</option>';
  items.forEach(i => {
    const o = document.createElement('option');
    o.value = i.id;
    o.textContent = i.name;
    sel.appendChild(o);
  });
}

function closeModal() { document.getElementById('ag-overlay').classList.remove('open'); }

async function handleSave(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const profId = fd.get('professional_id');
  const patId = fd.get('patient_id');
  const procId = fd.get('procedure_id');
  const insId = fd.get('insurance_id');

  if (!profId) { toast('Selecione um profissional', 'err'); return; }
  if (!patId) { toast('Selecione um paciente', 'err'); return; }
  if (!procId) { toast('Selecione um procedimento', 'err'); return; }
  if (!insId) { toast('Selecione um convênio', 'err'); return; }
  if (!fd.get('appointment_date')) { toast('Data é obrigatória', 'err'); return; }
  if (!fd.get('appointment_time')) { toast('Hora é obrigatória', 'err'); return; }

  const data = {
    professional_id: profId,
    patient_id: patId,
    procedure_id: procId,
    insurance_id: insId,
    appointment_date: fd.get('appointment_date'),
    appointment_time: fd.get('appointment_time'),
    value: parseFloat(fd.get('value')) || 0,
    status: fd.get('status') || 'Agendado',
    notes: fd.get('notes') || '',
  };

  console.log('[Agenda] Saving appointment:', data);

  try {
    if (form.dataset.mode === 'create') {
      const { error } = await supabase.from('appointments').insert([data]);
      if (error) { toast('Erro ao criar: ' + error.message, 'err'); console.error('Insert error:', error); return; }
      toast('Agendamento criado com sucesso!');
    } else {
      data.updated_at = new Date().toISOString();
      const { error } = await supabase.from('appointments').update(data).eq('id', form.dataset.apptId);
      if (error) { toast('Erro ao atualizar: ' + error.message, 'err'); console.error('Update error:', error); return; }
      toast('Agendamento atualizado!');
    }
    closeModal();
    await loadAgenda();
  } catch(err) {
    toast('Erro inesperado: ' + err.message, 'err');
    console.error('Save error:', err);
  }
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

  document.getElementById('pay-info').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;background:var(--bg-input);border-radius:var(--radius-sm)">
      <div><small style="color:var(--t3)">Paciente</small><div style="font-weight:600">${a.patient_name}</div></div>
      <div><small style="color:var(--t3)">Procedimento</small><div style="font-weight:600">${a.procedure_name}</div></div>
      <div><small style="color:var(--t3)">Valor</small><div style="font-weight:600;color:var(--p-400)">${fmtCurrency(a.value || 0)}</div></div>
      <div><small style="color:var(--t3)">Já pago</small><div style="font-weight:600;color:var(--success)">${fmtCurrency(a.pay_summary.paid)}</div></div>
    </div>
  `;

  const remaining = Math.max(0, (a.value || 0) - a.pay_summary.paid);
  form.querySelector('[name="amount"]').value = remaining.toFixed(2);
  form.querySelector('[name="discount"]').value = '0';
  form.querySelector('[name="surcharge"]').value = '0';
  calcFinal();

  // Load payment history
  try {
    const { data: history } = await supabase.from('payments')
      .select('*').eq('appointment_id', apptId).order('created_at', { ascending: false });
    const histDiv = document.getElementById('pay-history');
    if (history && history.length > 0) {
      histDiv.innerHTML = `
        <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px">Histórico de pagamentos</h4>
        ${history.map(h => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600;color:var(--p-400)">${fmtCurrency(h.final_amount)}</span>
              <span class="badge ${h.payment_status === 'Pago' ? 'badge-green' : 'badge-orange'}">${h.payment_status}</span>
            </div>
            <div style="font-size:.75rem;color:var(--t3);margin-top:4px">${h.payment_method} • ${h.paid_at ? new Date(h.paid_at).toLocaleDateString('pt-BR') : '—'}</div>
          </div>
        `).join('')}
      `;
    } else { histDiv.innerHTML = ''; }
  } catch(e) {
    console.warn('Payment history failed:', e);
    document.getElementById('pay-history').innerHTML = '';
  }

  document.getElementById('pay-overlay').classList.add('open');
}

function closePayModal() { payTargetAppt = null; document.getElementById('pay-overlay').classList.remove('open'); }

async function handlePayment(e) {
  e.preventDefault();
  if (!payTargetAppt) return;
  const form = e.target;
  const fd = new FormData(form);

  const amount = parseFloat(fd.get('amount')) || 0;
  const discount = parseFloat(fd.get('discount')) || 0;
  const surcharge = parseFloat(fd.get('surcharge')) || 0;
  const finalAmount = Math.max(0, amount - discount + surcharge);

  if (finalAmount <= 0) { toast('Valor inválido', 'err'); return; }

  const data = {
    appointment_id: payTargetAppt.id,
    patient_id: payTargetAppt.patient_id,
    amount,
    discount,
    surcharge,
    final_amount: finalAmount,
    payment_method: fd.get('payment_method') || 'Dinheiro',
    payment_status: fd.get('payment_status') || 'Pago',
    paid_at: new Date().toISOString(),
    notes: fd.get('pay_notes') || '',
    created_by: currentUser.id || null,
  };

  console.log('[Payment] Saving:', data);

  try {
    const { error } = await supabase.from('payments').insert([data]);
    if (error) { toast('Erro ao registrar pagamento: ' + error.message, 'err'); console.error('Payment error:', error); return; }
    toast('Pagamento registrado!');
    closePayModal();
    await loadAgenda();
  } catch(err) {
    toast('Erro: ' + err.message, 'err');
  }
}

init();
