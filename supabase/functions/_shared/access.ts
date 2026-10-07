import { supabaseAdmin } from "./supabaseAdmin.ts";

export async function hasActiveEntitlement(
  userId: string,
  entitlementType:
    | "premium"
    | "mock_test"
    | "study_material"
    | "ad_free"
    | "result_history",
  itemId?: string | null,
) {
  const now =
    new Date().toISOString();

  let query =
    supabaseAdmin
      .from("user_entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq(
        "entitlement_type",
        entitlementType,
      )
      .eq("status", "active")
      .lte("starts_at", now)
      .or(
        `expires_at.is.null,expires_at.gt.${now}`,
      );

  if (itemId) {
    query = query.eq(
      "item_id",
      itemId,
    );
  }

  const {
    data,
    error,
  } = await query
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

export async function canAccessMockTest(
  userId: string,
  testId: string,
) {
  const adminResult =
    await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

  if (adminResult.error) {
    throw adminResult.error;
  }

  if (
    adminResult.data?.role ===
    "admin"
  ) {
    return true;
  }

  const premium =
    await hasActiveEntitlement(
      userId,
      "premium",
    );

  if (premium) {
    return true;
  }

  return await hasActiveEntitlement(
    userId,
    "mock_test",
    testId,
  );
}
