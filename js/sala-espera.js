// js/sala-espera.js — Waiting Room (robust)
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, getInitials, avatarColor, fmtDateISO, toast } from './layout.js';

let currentUser = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  if (!can(currentUser.profile.role, 'waiting_room')) { window.location.href = '../index.html'; return; }

  initLayout(currentUser, 'waiting');
  await loadWaitingRoom();

  try {
    supabase.channel('wr-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => loadWaitingRoom())
      .subscribe();
  } catch(e) { console.warn('Realtime:', e); }
}

async function loadWaitingRoom() {
  const content = document.getElementById('wr-content');
  content.innerHTML = '<div class="page-loader"><span class="spinner"></span> Carregando...</div>';

  try {
    const today = fmtDateISO(new Date());

    // Step 1: Load appointments (no joins — more robust)
    const { data: rawAppts, error: apptErr } = await supabase
      .from('appointments')
      .select('id, professional_id, patient_id, procedure_id, appointment_time')
      .eq('appointment_date', today)
      .eq('status', 'Paciente na recepção')
      .order('appointment_time');

    if (apptErr) {
      console.error('WR appointments error:', apptErr);
      content.innerHTML = `<div class="empty"><p>Erro: ${apptErr.message}</p></div>`;
      return;
    }

    const records = rawAppts || [];
    const total = records.length;

    if (total === 0) {
      content.innerHTML = `
        <div class="card" style="padding:40px;text-align:center">
          <div class="wr-total"><div class="wr-num">0</div><div class="wr-lbl">Pacientes aguardando</div></div>
          <div class="empty" style="margin-top:20px"><p>Nenhum paciente na recepção no momento</p></div>
        </div>`;
      return;
    }

    // Step 2: Load related data separately
    const profIds = [...new Set(records.filter(r => r.professional_id).map(r => r.professional_id))];
    const patIds = [...new Set(records.filter(r => r.patient_id).map(r => r.patient_id))];
    const procIds = [...new Set(records.filter(r => r.procedure_id).map(r => r.procedure_id))];

    let profsMap = {}, patsMap = {}, procsMap = {};

    if (profIds.length) {
      const { data: profs } = await supabase.from('professionals').select('id, name').in('id', profIds);
      (profs || []).forEach(p => profsMap[p.id] = p.name);
    }
    if (patIds.length) {
      const { data: pats } = await supabase.from('patients').select('id, name').in('id', patIds);
      (pats || []).forEach(p => patsMap[p.id] = p.name);
    }
    if (procIds.length) {
      const { data: procs } = await supabase.from('procedures_catalog').select('id, name').in('id', procIds);
      (procs || []).forEach(p => procsMap[p.id] = p.name);
    }

    // Group by professional
    const grouped = {};
    records.forEach(r => {
      const profName = profsMap[r.professional_id] || 'Sem profissional';
      if (!grouped[profName]) grouped[profName] = [];
      grouped[profName].push({
        ...r,
        patient_name: patsMap[r.patient_id] || '—',
        procedure_name: procsMap[r.procedure_id] || '—',
      });
    });

    const professionals = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

    content.innerHTML = `
      <div class="card">
        <div class="wr-total">
          <div class="wr-num">${total}</div>
          <div class="wr-lbl">Pacientes aguardando</div>
        </div>
        <div class="wr-doctors">
          ${professionals.map(([name, patients]) => `
            <div class="wr-doc">
              <div class="doc-av" style="background:${avatarColor(name)}">${getInitials(name)}</div>
              <div style="flex:1">
                <div class="doc-name">${name}</div>
                <div style="font-size:.75rem;color:var(--t3)">${patients.length} paciente${patients.length > 1 ? 's' : ''}</div>
              </div>
              <div class="doc-count">${patients.length}</div>
            </div>
            <div style="padding:0 16px 12px">
              ${patients.map(p => `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
                  <div class="user-avatar" style="width:28px;height:28px;font-size:.65rem;background:${avatarColor(p.patient_name)}">${getInitials(p.patient_name)}</div>
                  <div style="flex:1">
                    <div style="font-size:.82rem;font-weight:500">${p.patient_name}</div>
                    <div style="font-size:.72rem;color:var(--t3)">${p.procedure_name} • ${p.appointment_time || ''}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('WR error:', err);
    content.innerHTML = `<div class="empty"><p>Erro: ${err.message || err}</p></div>`;
    toast('Erro ao carregar sala de espera', 'err');
  }
}

init();
