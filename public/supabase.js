import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://oeutuzepqpjzfyaujbne.supabase.co'
const supabaseKey = window.SUPABASE_ANON_KEY;
const missingSupabaseConfig = !supabaseKey || supabaseKey.includes('PLACEHOLDER');
const configErrorMessage = 'SUPABASE_ANON_KEY belum diset di Vercel Environment Variables.';

function getConfigError() {
  return { message: configErrorMessage };
}

function showConfigError() {
  const authError = document.getElementById('auth-error');
  if (authError) {
    authError.innerText = configErrorMessage;
    authError.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
  }
}

function createMissingConfigClient() {
  window.__APP_CONFIG_ERROR__ = configErrorMessage;
  window.addEventListener('DOMContentLoaded', showConfigError);

  return {
    auth: {
      onAuthStateChange(callback) {
        setTimeout(() => callback('INITIAL_SESSION', null), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      signUp: async () => ({ data: null, error: getConfigError() }),
      signInWithPassword: async () => ({ data: null, error: getConfigError() }),
      signInWithOAuth: async () => ({ data: null, error: getConfigError() })
    }
  };
}

export const supabase = missingSupabaseConfig
  ? createMissingConfigClient()
  : createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    )
