export type Question = {
  id: string;
  question_order: number;
  section_id: string | null;
  subject: string | null;
  topic: string | null;
  question_type: string | null;
  source_type: string | null;
  pyq_year: string | null;
  pyq_shift: string | null;
  pyq_question_number: number | null;
  marks: number | null;
  question_image_path: string | null;
};

export type AnswerKey = {
  correct_option: string;
  explanation: string | null;
};

export function calculateScore(
  questions: Question[],
  answerMap: Map<string, AnswerKey>,
  answers: Record<string, string>,
  negativeMark: number,
) {
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let score = 0;

  const review = [];

  for (const question of questions) {
    const selected =
      answers[question.id] || null;

    const answer =
      answerMap.get(question.id);

    const correctOption =
      answer?.correct_option || null;

    const marks =
      Number(question.marks || 0);

    let result = "skipped";
    let questionScore = 0;

    if (!selected) {
      skipped++;
    } else if (
      answer &&
      selected.toUpperCase() ===
        correctOption?.toUpperCase()
    ) {
      correct++;
      result = "correct";
      questionScore = marks;
      score += marks;
    } else {
      wrong++;
      result = "wrong";

      questionScore =
        negativeMark > 0
          ? -negativeMark
          : 0;

      score += questionScore;
    }

    review.push({
      question_id: question.id,
      question_order:
        question.question_order,
      section_id:
        question.section_id,
      subject:
        question.subject,
      topic:
        question.topic,
      question_type:
        question.question_type,
      source_type:
        question.source_type,
      pyq_year:
        question.pyq_year,
      pyq_shift:
        question.pyq_shift,
      pyq_question_number:
        question.pyq_question_number,
      question_image_path:
        question.question_image_path,
      selected_answer:
        selected,
      correct_answer:
        correctOption,
      result,
      marks,
      score: questionScore,
      explanation:
        answer?.explanation || null,
    });
  }

  return {
    correct,
    wrong,
    skipped,
    score,
    review,
  };
}
