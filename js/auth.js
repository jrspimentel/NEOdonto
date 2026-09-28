// js/auth.js — Authentication & session guard
import { supabase } from './supabase.js';

/** Build a relative path from the current page to the project root */
function resolvePath(path) {
  // path should be relative to project root, e.g. 'pages/login.html' or 'index.html'
  const depth = window.location.pathname.split('/').filter(Boolean).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  return prefix + path;
}

/**
 * Return current session user + profile, or null.
 */
export async function getCurrentUser() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  console.log('[auth] getSession:', session ? 'OK' : 'no session', sessionError || '');
  if (!session) return null;

  // Try to load profile, but don't block login if profile table is missing or empty
  let profile = null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (error) {
      console.warn('[auth] Profile query failed:', error.message);
      // Create a default profile from user metadata so the app can work
      profile = {
        id: session.user.id,
        name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
        role: session.user.user_metadata?.role || 'admin',
        email: session.user.email,
      };
    } else {
      profile = data;
    }
  } catch (e) {
    console.warn('[auth] Profile fetch error:', e);
    profile = {
      id: session.user.id,
      name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Usuário',
      role: session.user.user_metadata?.role || 'admin',
      email: session.user.email,
    };
  }

  console.log('[auth] User loaded:', session.user.email, 'Role:', profile.role);
  return { ...session.user, profile };
}

/**
 * Redirect unauthenticated users to login page.
 * Returns the profile if authenticated.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = resolvePath('pages/login.html');
    return null;
  }
  return user;
}

/**
 * Sign in with email + password.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Sign out and redirect to login.
 */
export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = resolvePath('pages/login.html');
}

/**
 * Permission matrix.
 * Key = permission name, value = array of roles allowed.
 * 'view_only' means the role can see but not act.
 */
const PERMISSIONS = {
  dashboard:             ['admin', 'dentista', 'recepcionista'],
  financial_indicators:  ['admin', 'recepcionista'],
  financial_charts:      ['admin'],
  view_patients:         ['admin', 'dentista', 'recepcionista', 'auxiliar'],
  create_patient:        ['admin', 'dentista', 'recepcionista'],
  edit_patient:          ['admin', 'dentista', 'recepcionista'],
  delete_patient:        ['admin'],
  view_history:          ['admin', 'dentista', 'recepcionista', 'auxiliar'],
  create_procedure:      ['admin', 'dentista', 'recepcionista'],
  edit_procedure:        ['admin', 'dentista'],
  delete_procedure:      ['admin'],
  view_agenda:           ['admin', 'dentista', 'recepcionista', 'auxiliar'],
  create_appointment:    ['admin', 'recepcionista'],
  edit_appointment:      ['admin', 'recepcionista'],
  delete_appointment:    ['admin'],
  change_status:         ['admin', 'recepcionista'],
  waiting_room:          ['admin', 'dentista', 'recepcionista', 'auxiliar'],
  // Payment permissions
  view_payments:         ['admin', 'recepcionista'],
  create_payment:        ['admin', 'recepcionista'],
  edit_payment:          ['admin', 'recepcionista'],
  cancel_payment:        ['admin'],
  delete_payment:        ['admin'],
  manage_users:          ['admin'],
  settings:              ['admin'],
};

/**
 * Check if a role has a specific permission.
 */
export function can(role, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * Get the menu items allowed for a role.
 */
export function getMenuForRole(role) {
  const allItems = [
    { id: 'dashboard', label: 'Dashboard',     icon: 'dashboard',  perm: 'dashboard' },
    { id: 'patients',  label: 'Pacientes',     icon: 'patients',   perm: 'view_patients' },
    { id: 'agenda',    label: 'Agenda do Dia',  icon: 'calendar',   perm: 'view_agenda' },
    { id: 'waiting',   label: 'Sala de Espera', icon: 'waiting',    perm: 'waiting_room' },
  ];
  return allItems.filter(item => can(role, item.perm));
}
