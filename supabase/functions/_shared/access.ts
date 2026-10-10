import { supabaseAdmin } from "./supabaseAdmin.ts";

type EntitlementType =
  | "premium"
  | "mock_test"
  | "study_material"
  | "ad_free"
  | "result_history";

/**
 * Checks whether a user has an active entitlement.
 */
export async function hasActiveEntitlement(
  userId: string,
  entitlementType: EntitlementType,
  itemId?: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();

  let query = supabaseAdmin
    .from("user_entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("entitlement_type", entitlementType)
    .eq("status", "active")
    .lte("starts_at", now)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  if (itemId) {
    query = query.eq("item_id", itemId);
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

/**
 * Checks active Premium membership independently.
 *
 * An entitlement for an individual mock test does NOT
 * automatically count as Premium membership.
 */
export async function hasActivePremium(
  userId: string,
): Promise<boolean> {
  const isPremium = await hasActiveEntitlement(
    userId,
    "premium",
  );

  const hasResultHistory = await hasActiveEntitlement(
    userId,
    "result_history",
  );

  return isPremium || hasResultHistory;
}

/**
 * Checks whether a user can access a particular mock test.
 */
export async function canAccessMockTest(
  userId: string,
  testId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data?.role === "admin") {
    return true;
  }

  if (await hasActivePremium(userId)) {
    return true;
  }

  return await hasActiveEntitlement(
    userId,
    "mock_test",
    testId,
  );
}
