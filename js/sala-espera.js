// js/sala-espera.js — Waiting Room page logic
import { supabase } from './supabase.js';
import { requireAuth, can } from './auth.js';
import { initLayout, Icons, getInitials, avatarColor, fmtDateISO, toast, showLoader } from './layout.js';

let currentUser = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  if (!can(currentUser.profile.role, 'waiting_room')) {
    window.location.href = '../index.html';
    return;
  }

  initLayout(currentUser, 'waiting');
  await loadWaitingRoom();

  // Auto-refresh every 30 seconds
  setInterval(loadWaitingRoom, 30000);
}

async function loadWaitingRoom() {
  const content = document.getElementById('wr-content');

  try {
    const today = fmtDateISO(new Date());

    const { data, error } = await supabase
      .from('procedures')
      .select('professional')
      .eq('date', today)
      .eq('situation', 'Paciente na recepção');

    if (error) throw error;

    const records = data || [];
    const total = records.length;

    // Group by professional
    const grouped = {};
    records.forEach(r => {
      const name = r.professional || 'Sem profissional';
      grouped[name] = (grouped[name] || 0) + 1;
    });

    const professionals = Object.entries(grouped).sort((a, b) => b[1] - a[1]);

    content.innerHTML = `
      <div class="card">
        <div class="wr-total">
          <div class="wr-num">${total}</div>
          <div class="wr-lbl">Total geral</div>
        </div>
        ${professionals.length > 0 ? `
          <div class="wr-doctors">
            ${professionals.map(([name, count]) => `
              <div class="wr-doc">
                <div class="doc-av" style="background:${avatarColor(name)}">${getInitials(name)}</div>
                <div class="doc-name">${name}</div>
                <div class="doc-count">${count}</div>
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

// Init
init();
