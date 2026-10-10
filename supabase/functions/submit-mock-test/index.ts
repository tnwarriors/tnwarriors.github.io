mimport { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  getAuthenticatedUser,
  isAdmin,
} from "../_shared/auth.ts";
import {
  canAccessMockTest,
  hasActivePremium,
  hasActiveEntitlement,
} from "../_shared/access.ts";
import {
  calculateScore,
  type Question,
  type AnswerKey,
} from "../_shared/scoring.ts";
import {
  getPercentage,
  getTemporaryExpiry,
  getTimeTaken,
} from "../_shared/result.ts";

const TEMPORARY_RESULT_MINUTES = 20;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function buildSectionResults(review: any[]) {
  const sections: Record<string, any> = {};

  for (const item of review) {
    const key = item.section_id || item.subject || "general";

    if (!sections[key]) {
      sections[key] = {
        section_id: item.section_id || null,
        subject: item.subject || "General",
        total: 0,
        correct: 0,
        wrong: 0,
        skipped: 0,
        score: 0,
        accuracy: 0,
      };
    }

    const section = sections[key];
    section.total++;

    if (item.result === "correct") {
      section.correct++;
    } else if (item.result === "wrong") {
      section.wrong++;
    } else {
      section.skipped++;
    }

    section.score += Number(item.score || 0);
  }

  return Object.values(sections).map((section: any) => ({
    ...section,
    accuracy: section.total
      ? Number(((section.correct / section.total) * 100).toFixed(2))
      : 0,
  }));
}

async function loadTest(testId: string) {
  const { data, error } = await supabaseAdmin
    .from("mock_tests")
    .select(`
      id,
      title,
      exam_name,
      duration_minutes,
      total_marks,
      negative_mark,
      status,
      published,
      access_type
    `)
    .eq("id", testId)
    .eq("published", true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadQuestions(testId: string) {
  const { data, error } = await supabaseAdmin
    .from("mock_questions")
    .select(`
      id,
      question_order,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      question_image_path,
      option_a_image_path,
      option_b_image_path,
      option_c_image_path,
      option_d_image_path,
      section_id,
      subject,
      topic,
      question_type,
      source_type,
      pyq_year,
      pyq_shift,
      pyq_question_number,
      marks
    `)
    .eq("mock_test_id", testId)
    .order("question_order", { ascending: true });

  if (error) throw error;

  return data || [];
}

async function loadAnswers(questionIds: string[]) {
  if (!questionIds.length) {
    return new Map<string, AnswerKey>();
  }

  const { data, error } = await supabaseAdmin
    .from("mock_answers")
    .select("question_id, correct_option, explanation")
    .in("question_id", questionIds);

  if (error) throw error;

  const map = new Map<string, AnswerKey>();

  for (const row of data || []) {
    map.set(row.question_id, {
      correct_option: row.correct_option,
      explanation: row.explanation || null,
    });
  }

  return map;
}

async function createReviewWithImages(
  questions: any[],
  answerMap: Map<string, AnswerKey>,
  answers: Record<string, unknown>,
  negativeMark: number,
) {
  const scoringQuestions = questions as Question[];

  const safeAnswers: Record<string, string> = {};

  for (const question of questions) {
    const selected = answers[question.id];

    if (selected === undefined || selected === null || selected === "") {
      continue;
    }

    if (typeof selected !== "string") {
      throw new Error("Invalid answer format.");
    }

    const normalized = selected.toUpperCase();

    if (!["A", "B", "C", "D"].includes(normalized)) {
      throw new Error("Invalid answer option.");
    }

    safeAnswers[question.id] = normalized;
  }

  const calculated = calculateScore(
    scoringQuestions,
    answerMap,
    safeAnswers,
    negativeMark,
  );

  const review = calculated.review.map((item: any) => {
    const question = questions.find((q) => q.id === item.question_id);

    return {
      ...item,
      question_text: question?.question_text || "",
      option_a: question?.option_a || "",
      option_b: question?.option_b || "",
      option_c: question?.option_c || "",
      option_d: question?.option_d || "",
      option_a_image_path: question?.option_a_image_path || null,
      option_b_image_path: question?.option_b_image_path || null,
      option_c_image_path: question?.option_c_image_path || null,
      option_d_image_path: question?.option_d_image_path || null,
    };
  });

  return {
    calculated: {
      ...calculated,
      review,
    },
    safeAnswers,
  };
}

async function makeImageUrls(review: any[]) {
  const bucket = "tn-warriors-question-images";

  const paths = new Set<string>();

  for (const item of review) {
    for (const path of [
      item.question_image_path,
      item.option_a_image_path,
      item.option_b_image_path,
      item.option_c_image_path,
      item.option_d_image_path,
    ]) {
      if (typeof path === "string" && path.trim()) {
        paths.add(path);
      }
    }
  }

  const urlMap = new Map<string, string>();

  for (const path of paths) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 20);

    if (error) {
      console.error("Image signing failed:", error.message);
      continue;
    }

    if (data?.signedUrl) {
      urlMap.set(path, data.signedUrl);
    }
  }

  return review.map((item) => ({
    ...item,
    question_image_url: item.question_image_path
      ? urlMap.get(item.question_image_path) || null
      : null,
    option_a_image_url: item.option_a_image_path
      ? urlMap.get(item.option_a_image_path) || null
      : null,
    option_b_image_url: item.option_b_image_path
      ? urlMap.get(item.option_b_image_path) || null
      : null,
    option_c_image_url: item.option_c_image_path
      ? urlMap.get(item.option_c_image_path) || null
      : null,
    option_d_image_url: item.option_d_image_path
      ? urlMap.get(item.option_d_image_path) || null
      : null,
  }));
}

async function handleStart(testId: string | null, user: any) {
  if (!testId) {
    return json({ error: "test_id is required." }, 400);
  }

  const test = await loadTest(testId);

  if (!test) {
    return json({ error: "Mock test not found or not published." }, 404);
  }

  if (!user) {
    return json({
      success: true,
      guest: true,
      resumed: false,
      attempt_id: null,
      started_at: new Date().toISOString(),
      test,
    });
  }

  const allowed = await canAccessMockTest(user.id, testId);

  if (!allowed) {
    return json({ error: "You do not have access to this mock test." }, 403);
  }

  const { data: existingAttempts, error: attemptsError } =
    await supabaseAdmin
      .from("mock_attempts")
      .select("id, status, started_at, submitted_at, time_taken_seconds, auto_submitted")
      .eq("user_id", user.id)
      .eq("mock_test_id", testId)
      .order("started_at", { ascending: false })
      .limit(1);

  if (attemptsError) throw attemptsError;

  const existing = existingAttempts?.[0];

  const isPractice =
    String(test.access_type || "").toLowerCase() === "practice";

  if (existing?.status === "started") {
    return json({
      success: true,
      resumed: true,
      attempt_id: existing.id,
      attempt_status: existing.status,
      started_at: existing.started_at,
      submitted_at: existing.submitted_at,
      time_taken_seconds: existing.time_taken_seconds,
      auto_submitted: existing.auto_submitted,
      test,
    });
  }

  if (existing && !isPractice) {
    return json({
      success: false,
      error: "OFFICIAL_ATTEMPT_ALREADY_USED",
      message: "This official mock exam has already been attempted.",
    }, 409);
  }

  const { data: attempt, error } = await supabaseAdmin
    .from("mock_attempts")
    .insert({
      user_id: user.id,
      mock_test_id: testId,
      status: "started",
      started_at: new Date().toISOString(),
    })
    .select("id, started_at, status")
    .single();

  if (error) throw error;

  return json({
    success: true,
    resumed: false,
    attempt_id: attempt.id,
    attempt_status: attempt.status,
    started_at: attempt.started_at,
    test,
  });
}

async function handleSubmit(body: any, user: any) {
  const testId = getString(body.test_id);

  if (!testId) {
    return json({ error: "test_id is required." }, 400);
  }

  const test = await loadTest(testId);

  if (!test) {
    return json({ error: "Mock test not found or not published." }, 404);
  }

  const answers = body.answers;

  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return json({ error: "answers must be an object." }, 400);
  }

  const questions = await loadQuestions(testId);

  if (!questions.length) {
    return json({ error: "This mock test has no questions." }, 400);
  }

  const questionIds = questions.map((question) => question.id);
  const answerMap = await loadAnswers(questionIds);

  let startedAt = getString(body.started_at) || new Date().toISOString();
  let attemptId: string | null = null;
  let autoSubmitted = false;

  if (user) {
    if (!(await canAccessMockTest(user.id, testId))) {
      return json({ error: "You do not have access to this mock test." }, 403);
    }

    attemptId = getString(body.attempt_id);

    if (!attemptId) {
      return json({ error: "attempt_id is required." }, 400);
    }

    const { data: attempt, error } = await supabaseAdmin
      .from("mock_attempts")
      .select("id, user_id, mock_test_id, status, started_at")
      .eq("id", attemptId)
      .eq("user_id", user.id)
      .eq("mock_test_id", testId)
      .maybeSingle();

    if (error) throw error;

    if (!attempt) {
      return json({ error: "Mock attempt not found." }, 404);
    }

    if (attempt.status !== "started") {
      return json({ error: "This mock attempt has already been submitted." }, 409);
    }

    startedAt = attempt.started_at;
  }

  const durationMinutes = Math.max(0, Number(test.duration_minutes || 0));
  const timeTaken = getTimeTaken(startedAt, durationMinutes);
  const allowedSeconds = durationMinutes * 60;

  if (allowedSeconds > 0 && timeTaken > allowedSeconds + 30) {
    autoSubmitted = true;
  }

  const negativeMark = Math.max(0, Number(test.negative_mark || 0));

  const { calculated, safeAnswers } = await createReviewWithImages(
    questions,
    answerMap,
    answers,
    negativeMark,
  );

  const totalMarks = Number(
    test.total_marks ||
      questions.reduce((sum, question) => sum + Number(question.marks || 0), 0),
  );

  const percentage = getPercentage(calculated.score, totalMarks);
  const sectionResults = buildSectionResults(calculated.review);
  const reviewWithImages = await makeImageUrls(calculated.review);

  let permanent = false;
  let permanentResultId: string | null = null;

  if (user) {
    const admin = await isAdmin(user.id);
    const premium = await hasActivePremium(user.id);

    const hasHistoryEntitlement = await hasActiveEntitlement(
      user.id,
      "result_history",
    );

    permanent = admin || premium || hasHistoryEntitlement;

    const { data: updatedAttempt, error: updateError } = await supabaseAdmin
      .from("mock_attempts")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        time_taken_seconds: timeTaken,
        auto_submitted: autoSubmitted,
      })
      .eq("id", attemptId)
      .eq("user_id", user.id)
      .eq("status", "started")
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedAttempt) {
      return json({ error: "This mock attempt was already submitted." }, 409);
    }

    if (permanent) {
      const { data: result, error } = await supabaseAdmin
        .from("mock_results")
        .insert({
          user_id: user.id,
          mock_test_id: testId,
          score: calculated.score,
          correct_count: calculated.correct,
          wrong_count: calculated.wrong,
          skipped_count: calculated.skipped,
          total_marks: totalMarks,
          percentage,
          answers: safeAnswers,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          time_taken_seconds: timeTaken,
          auto_submitted: autoSubmitted,
          section_results: sectionResults,
          review: calculated.review,
        })
        .select("id")
        .single();

      if (error) throw error;
      permanentResultId = result.id;
    }
  }

  return json({
    success: true,
    test_id: testId,
    attempt_id: attemptId,
    score: calculated.score,
    total_marks: totalMarks,
    percentage,
    correct_count: calculated.correct,
    wrong_count: calculated.wrong,
    skipped_count: calculated.skipped,
    accuracy: questions.length
      ? Number(((calculated.correct / questions.length) * 100).toFixed(2))
      : 0,
    total_questions: questions.length,
    time_taken_seconds: timeTaken,
    auto_submitted: autoSubmitted,
    section_results: sectionResults,
    review: reviewWithImages,
    temporary_expires_at: permanent
      ? null
      : getTemporaryExpiry(TEMPORARY_RESULT_MINUTES),
    permanent,
    permanent_result_id: permanentResultId,
    test,
  });
}

async function handleGetResult(body: any, user: any) {
  if (!user) {
    return json({
      error: "Authentication is required to retrieve a saved result.",
    }, 401);
  }

  const resultId = getString(body.result_id);

  if (!resultId) {
    return json({ error: "result_id is required." }, 400);
  }

  const { data: result, error } = await supabaseAdmin
    .from("mock_results")
    .select("*")
    .eq("id", resultId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (!result) {
    return json({ error: "Saved result not found." }, 404);
  }

  const admin = await isAdmin(user.id);
  const premium = await hasActivePremium(user.id);
  const history = await hasActiveEntitlement(user.id, "result_history");

  if (!admin && !premium && !history) {
    return json({
      error: "An active Premium or result-history entitlement is required.",
    }, 403);
  }

  const review = Array.isArray(result.review) ? result.review : [];

  return json({
    success: true,
    permanent: true,
    result: {
      ...result,
      review: await makeImageUrls(review),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);

    if (contentLength > MAX_REQUEST_BODY_BYTES) {
      return json({ error: "Request body too large." }, 413);
    }

    const body = await req.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Invalid request body." }, 400);
    }

    const action = body.action || "submit";
    const user = await getAuthenticatedUser(req);

    if (action === "start") {
      return await handleStart(getString(body.test_id), user);
    }

    if (action === "submit") {
      return await handleSubmit(body, user);
    }

    if (action === "get_result") {
      return await handleGetResult(body, user);
    }

    return json({ error: "Invalid action." }, 400);
  } catch (error) {
    console.error("submit-mock-test error:", error);

    return json({
      error: error instanceof Error ? error.message : "Internal server error.",
    }, 500);
  }
});
