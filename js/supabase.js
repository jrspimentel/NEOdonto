// js/supabase.js — Supabase client singleton
// ⚠️ SUBSTITUA pelos valores do seu projeto Supabase (Project Settings > API)
const SUPABASE_URL = 'https://sonfortsfbadmcylwjah.supabase.co';
const SUPABASE_ANON = 'sb_publishable_IemmyHzx57Nt2mcoLEIysg_5iNA1fUT';

// Carrega o SDK via CDN (ESM)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
