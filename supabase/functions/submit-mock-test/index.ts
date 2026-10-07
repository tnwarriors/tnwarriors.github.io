import { corsHeaders } from "../_shared/cors.ts";
import {
  supabaseAdmin,
} from "../_shared/supabaseAdmin.ts";
import {
  getAuthenticatedUser,
  isAdmin,
} from "../_shared/auth.ts";
import {
  canAccessMockTest,
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

function json(
  data: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}

function buildSectionResults(
  review: any[],
) {
  const sections: Record<
    string,
    {
      section_id: string;
      total: number;
      correct: number;
      wrong: number;
      skipped: number;
      score: number;
    }
  > = {};

  for (const item of review) {
    const key =
      item.section_id || "general";

    if (!sections[key]) {
      sections[key] = {
        section_id: key,
        total: 0,
        correct: 0,
        wrong: 0,
        skipped: 0,
        score: 0,
      };
    }

    sections[key].total++;

    if (item.result === "correct") {
      sections[key].correct++;
    } else if (
      item.result === "wrong"
    ) {
      sections[key].wrong++;
    } else {
      sections[key].skipped++;
    }

    sections[key].score +=
      Number(item.score || 0);
  }

  return Object.values(sections);
}

async function loadTest(
  testId: string,
) {
  const { data, error } =
    await supabaseAdmin
      .from("mock_tests")
      .select(
        `
        id,
        title,
        exam_name,
        duration_minutes,
        total_marks,
        negative_mark,
        status,
        published,
        access_type
        `,
      )
      .eq("id", testId)
      .eq("published", true)
      .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function loadQuestions(
  testId: string,
) {
  const { data, error } =
    await supabaseAdmin
      .from("mock_questions")
      .select(
        `
        id,
        question_order,
        section_id,
        subject,
        topic,
        question_type,
        source_type,
        pyq_year,
        pyq_shift,
        pyq_question_number,
        marks,
        question_image_path
        `,
      )
      .eq("mock_test_id", testId)
      .order(
        "question_order",
        { ascending: true },
      );

  if (error) {
    throw error;
  }

  return (data || []) as Question[];
}

async function loadAnswers(
  questionIds: string[],
) {
  if (questionIds.length === 0) {
    return new Map<string, AnswerKey>();
  }

  const { data, error } =
    await supabaseAdmin
      .from("mock_answers")
      .select(
        `
        question_id,
        correct_option,
        explanation
        `,
      )
      .in(
        "question_id",
        questionIds,
      );

  if (error) {
    throw error;
  }

  const map =
    new Map<string, AnswerKey>();

  for (const row of data || []) {
    map.set(
      row.question_id,
      {
        correct_option:
          row.correct_option,
        explanation:
          row.explanation || null,
      },
    );
  }

  return map;
}

async function handleStart(
  testId: string,
  user: any,
) {
  const test =
    await loadTest(testId);

  if (!test) {
    return json(
      {
        error:
          "Mock test not found or not published.",
      },
      404,
    );
  }

  if (user) {
    const allowed =
      await canAccessMockTest(
        user.id,
        testId,
      );

    if (!allowed) {
      return json(
        {
          error:
            "You do not have access to this mock test.",
        },
        403,
      );
    }

    const { data: existing } =
      await supabaseAdmin
        .from("mock_attempts")
        .select(
          "id, status, started_at, submitted_at, time_taken_seconds, auto_submitted",
        )
        .eq("user_id", user.id)
        .eq(
          "mock_test_id",
          testId,
        )
        .maybeSingle();

    if (existing) {
      return json({
        success: true,
        resumed: true,
        attempt_id: existing.id,
        attempt_status:
          existing.status,
        started_at:
          existing.started_at,
        submitted_at:
          existing.submitted_at,
        time_taken_seconds:
          existing.time_taken_seconds,
        auto_submitted:
          existing.auto_submitted,
        test,
      });
    }

    const { data: attempt, error } =
      await supabaseAdmin
        .from("mock_attempts")
        .insert({
          user_id: user.id,
          mock_test_id: testId,
          status: "started",
          started_at:
            new Date().toISOString(),
        })
        .select(
          "id, started_at, status",
        )
        .single();

    if (error) {
      throw error;
    }

    return json({
      success: true,
      resumed: false,
      attempt_id: attempt.id,
      attempt_status:
        attempt.status,
      started_at:
        attempt.started_at,
      test,
    });
  }

  return json({
    success: true,
    guest: true,
    resumed: false,
    attempt_id: null,
    started_at:
      new Date().toISOString(),
    test,
  });
}

async function handleSubmit(
  body: any,
  user: any,
) {
  const testId =
    body.test_id;

  if (!testId) {
    return json(
      {
        error:
          "test_id is required.",
      },
      400,
    );
  }

  const test =
    await loadTest(testId);

  if (!test) {
    return json(
      {
        error:
          "Mock test not found or not published.",
      },
      404,
    );
  }

  const answers =
    body.answers || {};

  const questions =
    await loadQuestions(testId);

  if (questions.length === 0) {
    return json(
      {
        error:
          "This mock test has no questions.",
      },
      400,
    );
  }

  const questionIds =
    questions.map(
      (question) =>
        question.id,
    );

  const answerMap =
    await loadAnswers(
      questionIds,
    );

  let startedAt =
    body.started_at ||
    new Date().toISOString();

  let attemptId:
    | string
    | null = null;

  let autoSubmitted =
    Boolean(
      body.auto_submitted,
    );

  if (user) {
    const allowed =
      await canAccessMockTest(
        user.id,
        testId,
      );

    if (!allowed) {
      return json(
        {
          error:
            "You do not have access to this mock test.",
        },
        403,
      );
    }

    attemptId =
      body.attempt_id ||
      null;

    if (!attemptId) {
      return json(
        {
          error:
            "attempt_id is required.",
        },
        400,
      );
    }

    const { data: attempt, error } =
      await supabaseAdmin
        .from("mock_attempts")
        .select(
          `
          id,
          user_id,
          mock_test_id,
          status,
          started_at
          `,
        )
        .eq("id", attemptId)
        .eq(
          "user_id",
          user.id,
        )
        .eq(
          "mock_test_id",
          testId,
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!attempt) {
      return json(
        {
          error:
            "Mock attempt not found.",
        },
        404,
      );
    }

    if (
      attempt.status !==
      "started"
    ) {
      return json(
        {
          error:
            "This mock attempt has already been submitted.",
        },
        409,
      );
    }

    startedAt =
      attempt.started_at;
  }

  const durationMinutes =
    Number(
      test.duration_minutes || 0,
    );

  const timeTaken =
    getTimeTaken(
      startedAt,
      durationMinutes,
    );

  const allowedSeconds =
    durationMinutes * 60;

  if (
    user &&
    allowedSeconds > 0 &&
    timeTaken >
      allowedSeconds + 30
  ) {
    autoSubmitted = true;
  }

  const negativeMark =
    Number(
      test.negative_mark || 0,
    );

  const calculated =
    calculateScore(
      questions,
      answerMap,
      answers,
      negativeMark,
    );

  const totalMarks =
    Number(
      test.total_marks ||
        questions.reduce(
          (
            total,
            question,
          ) =>
            total +
            Number(
              question.marks ||
                0,
            ),
          0,
        ),
    );

  const percentage =
    getPercentage(
      calculated.score,
      totalMarks,
    );

  const sectionResults =
    buildSectionResults(
      calculated.review,
    );

  let permanentResultId:
    | string
    | null = null;

  let permanent = false;

  if (user) {
    const admin =
      await isAdmin(
        user.id,
      );

    const premium =
      await canAccessMockTest(
        user.id,
        testId,
      );

    permanent =
      admin || premium;

    const { data: updatedAttempt, error: attemptError } =
      await supabaseAdmin
        .from("mock_attempts")
        .update({
          status: "submitted",
          submitted_at:
            new Date().toISOString(),
          time_taken_seconds:
            timeTaken,
          auto_submitted:
            autoSubmitted,
        })
        .eq(
          "id",
          attemptId,
        )
        .eq(
          "user_id",
          user.id,
        )
        .eq(
          "status",
          "started",
        )
        .select("id")
        .maybeSingle();

    if (attemptError) {
      throw attemptError;
    }

    if (!updatedAttempt) {
      return json(
        {
          error:
            "This mock attempt was already submitted.",
        },
        409,
      );
    }

    if (permanent) {
      const { data: result, error } =
        await supabaseAdmin
          .from("mock_results")
          .insert({
            user_id:
              user.id,
            mock_test_id:
              testId,
            score:
              calculated.score,
            correct_count:
              calculated.correct,
            wrong_count:
              calculated.wrong,
            skipped_count:
              calculated.skipped,
            total_marks:
              totalMarks,
            percentage,
            answers,
            started_at:
              startedAt,
            completed_at:
              new Date().toISOString(),
            time_taken_seconds:
              timeTaken,
            auto_submitted:
              autoSubmitted,
            section_results:
              sectionResults,
            review:
              calculated.review,
          })
          .select("id")
          .single();

      if (error) {
        throw error;
      }

      permanentResultId =
        result.id;
    }
  }

  const temporaryExpiry =
    getTemporaryExpiry(20);

  return json({
    success: true,
    test_id: testId,
    attempt_id: attemptId,
    score:
      calculated.score,
    total_marks:
      totalMarks,
    percentage,
    correct_count:
      calculated.correct,
    wrong_count:
      calculated.wrong,
    skipped_count:
      calculated.skipped,
    time_taken_seconds:
      timeTaken,
    auto_submitted:
      autoSubmitted,
    section_results:
      sectionResults,
    review:
      calculated.review,
    temporary_expires_at:
      temporaryExpiry,
    permanent,
    permanent_result_id:
      permanentResultId,
    test,
  });
}

Deno.serve(
  async (req) => {
    if (
      req.method ===
      "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers:
            corsHeaders,
        },
      );
    }

    if (
      req.method !== "POST"
    ) {
      return json(
        {
          error:
            "Method not allowed.",
        },
        405,
      );
    }

    try {
      const body =
        await req.json();

      const action =
        body.action ||
        "submit";

      const user =
        await getAuthenticatedUser(
          req,
        );

      if (
        action === "start"
      ) {
        return await handleStart(
          body.test_id,
          user,
        );
      }

      if (
        action === "submit"
      ) {
        return await handleSubmit(
          body,
          user,
        );
      }

      return json(
        {
          error:
            "Invalid action.",
        },
        400,
      );
    } catch (error) {
      console.error(
        "submit-mock-test error:",
        error,
      );

      return json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Internal server error.",
        },
        500,
      );
    }
  },
);
