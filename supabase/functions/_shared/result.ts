export function getPercentage(
  score: number,
  totalMarks: number,
) {
  if (totalMarks <= 0) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      (score / totalMarks) * 100,
    ),
  );
}

export function getTemporaryExpiry(
  minutes = 20,
) {
  return new Date(
    Date.now() +
      minutes * 60 * 1000,
  ).toISOString();
}

export function getTimeTaken(
  startedAt: string,
  durationMinutes: number,
) {
  const started =
    new Date(startedAt).getTime();

  const elapsed = Math.max(
    0,
    Math.floor(
      (Date.now() - started) / 1000,
    ),
  );

  const maximum =
    Math.max(0, durationMinutes) *
    60;

  return Math.min(
    elapsed,
    maximum,
  );
}
