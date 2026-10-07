import { createClient } from
  "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL")!;

const serviceRoleKey =
  Deno.env.get(
    "SUPABASE_SERVICE_ROLE_KEY",
  )!;

export const supabaseAdmin =
  createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
