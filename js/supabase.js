// js/supabase.js — Supabase client singleton
// ⚠️ SUBSTITUA pelos valores do seu projeto Supabase (Project Settings > API)
const SUPABASE_URL = 'https://sonfortsfbadmcylwjah.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvbmZvcnRzZmJhZG1jeWx3amFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1ODI1NDgsImV4cCI6MjEwNjE1ODU0OH0.hIHcxLzD2zDN4RVU7rjNJrG3xWpj8wBxsfdkUHR0Bvk';

// Carrega o SDK via CDN (ESM)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
