// js/sala-espera.js — Waiting Room with Realtime
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, getInitials, avatarColor, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  if (!can(currentUser.profile.role, 'waiting_room')) { window.location.href = '../index.html'; return; }

  initLayout(currentUser, 'waiting');
  await loadWaitingRoom();

  // Realtime — auto-refresh when appointments change
  supabase.channel('wr-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
      loadWaitingRoom();
    })
    .subscribe();
}

async function loadWaitingRoom() {
  const content = document.getElementById('wr-content');

  try {
    const today = fmtDateISO(new Date());

    const { data, error } = await supabase
      .from('appointments')
      .select('*, professionals(name), patients(name), procedures_catalog(name)')
      .eq('appointment_date', today)
      .eq('status', 'Paciente na recepção')
      .order('appointment_time');

    if (error) throw error;

    const records = data || [];
    const total = records.length;

    // Group by professional
    const grouped = {};
    records.forEach(r => {
      const name = r.professionals?.name || 'Sem profissional';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(r);
    });

    const professionals = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

    content.innerHTML = `
      <div class="card">
        <div class="wr-total">
          <div class="wr-num">${total}</div>
          <div class="wr-lbl">Pacientes aguardando</div>
        </div>
        ${professionals.length > 0 ? `
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
                    <div class="user-avatar" style="width:28px;height:28px;font-size:.65rem;background:${avatarColor(p.patients?.name || '')}">${getInitials(p.patients?.name || '—')}</div>
                    <div style="flex:1">
                      <div style="font-size:.82rem;font-weight:500">${p.patients?.name || '—'}</div>
                      <div style="font-size:.72rem;color:var(--t3)">${p.procedures_catalog?.name || '—'} • ${p.appointment_time || ''}</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty" style="padding:32px"><p>Nenhum paciente na recepção</p></div>
        `}
      </div>
    `;
  } catch (err) {
    console.error(err);
    content.innerHTML = '<div class="empty"><p>Erro ao carregar sala de espera</p></div>';
    toast('Erro ao carregar sala de espera', 'err');
  }
}

init();
