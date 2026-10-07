import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function getAuthenticatedUser(
  req: Request,
) {
  const authHeader =
    req.headers.get("Authorization");

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    return null;
  }

  const token =
    authHeader.substring(7);

  const {
    data,
    error,
  } = await supabaseAdmin.auth.getUser(
    token,
  );

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function isAdmin(
  userId: string,
) {
  const { data, error } =
    await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.role === "admin";
}
