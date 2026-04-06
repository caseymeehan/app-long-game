import { eq, and, sql, count, avg, max, min, sum, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";

type Grade = "A" | "B" | "C" | "D" | "F";

interface ScoringResult {
  correct: number;
  total: number;
  score: number;
}

interface QuizResult {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: Grade;
  totalCorrect: number;
  totalQuestions: number;
  questionResults: QuestionResult[];
}

interface QuestionResult {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
}

interface QuizStats {
  totalAttempts: number;
  averageScore: number;
  highScore: number;
  lowScore: number;
  passRate: number;
}

interface AttemptSummary {
  attemptId: number;
  score: number;
  passed: boolean;
  grade: Grade;
  attemptedAt: string;
}

type QuizQuestion = typeof quizQuestions.$inferSelect;

export function calculateGrade(score: number): Grade {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

async function scoreQuestionsByType(
  questions: QuizQuestion[],
  answers: { questionId: number; selectedOptionId: number }[],
  questionType: "multiple_choice" | "true_false"
): Promise<ScoringResult> {
  try {
    let correctCount = 0;
    let total = 0;

    for (const question of questions) {
      if (question.questionType !== questionType) continue;
      total++;

      const userAnswer = answers.find((a) => a.questionId === question.id);
      if (!userAnswer) continue;

      const [correctOpt] = await db
        .select()
        .from(quizOptions)
        .where(
          and(
            eq(quizOptions.questionId, question.id),
            eq(quizOptions.isCorrect, true)
          )
        );

      if (correctOpt && userAnswer.selectedOptionId === correctOpt.id) {
        correctCount++;
      }
    }

    return {
      correct: correctCount,
      total,
      score: total > 0 ? correctCount / total : 0,
    };
  } catch (err) {
    console.error(`[quiz-scoring] Failed to score ${questionType} questions:`, err);
    throw err;
  }
}

export async function getScore(
  quizId: number,
  answers: { questionId: number; selectedOptionId: number }[]
): Promise<{ score: number; totalCorrect: number; totalQuestions: number; passed: boolean; grade: Grade; mcResult: ScoringResult; tfResult: ScoringResult }> {
  try {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz) {
      return { score: 0, passed: false, grade: "F", totalCorrect: 0, totalQuestions: 0, mcResult: { correct: 0, total: 0, score: 0 }, tfResult: { correct: 0, total: 0, score: 0 } };
    }

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position);

    const mcResult = await scoreQuestionsByType(questions, answers, "multiple_choice");
    const tfResult = await scoreQuestionsByType(questions, answers, "true_false");

    const totalCorrect = mcResult.correct + tfResult.correct;
    const totalQuestions = mcResult.total + tfResult.total;
    const overallScore = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
    const passed = overallScore > 0.7;
    const grade = calculateGrade(overallScore);

    return {
      score: overallScore,
      totalCorrect,
      totalQuestions,
      passed,
      grade,
      mcResult,
      tfResult,
    };
  } catch (err) {
    console.error(`[quiz-scoring] Failed to score quiz ${quizId}:`, err);
    throw err;
  }
}

export async function computeResult(
  userId: number,
  quizId: number,
  selectedAnswers: Record<number, number>
): Promise<QuizResult | null> {
  try {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz) return null;

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position);

    let correct = 0;
    const total = questions.length;
    const questionResults: QuestionResult[] = [];

    for (const q of questions) {
      const selected = selectedAnswers[q.id];

      if (selected === undefined) {
        questionResults.push({
          questionId: q.id,
          correct: false,
          selectedOptionId: null,
          correctOptionId: null,
        });
        continue;
      }

      let correctOptionId: number | null = null;
      const [correctOpt] = await db
        .select()
        .from(quizOptions)
        .where(
          and(
            eq(quizOptions.questionId, q.id),
            eq(quizOptions.isCorrect, true)
          )
        );
      correctOptionId = correctOpt?.id ?? null;

      const isCorrect = selected === correctOptionId;
      if (isCorrect) correct++;

      questionResults.push({
        questionId: q.id,
        correct: isCorrect,
        selectedOptionId: selected,
        correctOptionId,
      });
    }

    const scoreValue = total > 0 ? correct / total : 0;
    const passed = scoreValue > 0.7;
    const grade = calculateGrade(scoreValue);

    const [attempt] = await db
      .insert(quizAttempts)
      .values({
        userId,
        quizId,
        score: scoreValue,
        passed,
      })
      .returning();

    for (const result of questionResults) {
      if (result.selectedOptionId !== null) {
        await db.insert(quizAnswers).values({
          attemptId: attempt.id,
          questionId: result.questionId,
          selectedOptionId: result.selectedOptionId,
        });
      }
    }

    return {
      attemptId: attempt.id,
      score: scoreValue,
      passed,
      grade,
      totalCorrect: correct,
      totalQuestions: total,
      questionResults,
    };
  } catch (err) {
    console.error(`[quiz-scoring] Failed to compute result for user ${userId}, quiz ${quizId}:`, err);
    throw err;
  }
}

export async function getQuizStats(quizId: number): Promise<QuizStats> {
  try {
    const [rows] = await db
      .select({
        totalAttempts: count(),
        avgScore: avg(quizAttempts.score),
        highScore: max(quizAttempts.score),
        lowScore: min(quizAttempts.score),
        passCount: sum(sql<number>`CASE WHEN ${quizAttempts.passed} = true THEN 1 ELSE 0 END`),
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.quizId, quizId));

    if (!rows || rows.totalAttempts === 0) {
      return {
        totalAttempts: 0,
        averageScore: 0,
        highScore: 0,
        lowScore: 0,
        passRate: 0,
      };
    }

    return {
      totalAttempts: rows.totalAttempts,
      averageScore: Number(rows.avgScore),
      highScore: Number(rows.highScore),
      lowScore: Number(rows.lowScore),
      passRate: Number(rows.passCount) / rows.totalAttempts,
    };
  } catch (err) {
    console.error(`[quiz-scoring] Failed to get stats for quiz ${quizId}:`, err);
    throw err;
  }
}

export async function getUserQuizHistory(userId: number, quizId: number): Promise<AttemptSummary[]> {
  try {
    const attempts = await db
      .select({
        id: quizAttempts.id,
        score: quizAttempts.score,
        passed: quizAttempts.passed,
        attemptedAt: quizAttempts.attemptedAt,
      })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.userId, userId),
          eq(quizAttempts.quizId, quizId)
        )
      )
      .orderBy(desc(quizAttempts.attemptedAt));

    return attempts.map((attempt) => ({
      attemptId: attempt.id,
      score: attempt.score,
      passed: attempt.passed,
      grade: calculateGrade(attempt.score),
      attemptedAt: attempt.attemptedAt,
    }));
  } catch (err) {
    console.error(`[quiz-scoring] Failed to get history for user ${userId}, quiz ${quizId}:`, err);
    throw err;
  }
}

export function renderQuizResults(
  score: number,
  total: number,
  passed: boolean,
  showAnswers: boolean,
  showExplanations: boolean
) {
  const percentage = total > 0 ? score / total : 0;
  const grade = calculateGrade(percentage);

  return {
    score,
    total,
    percentage,
    grade,
    passed,
    message: passed ? "Congratulations! You passed!" : "Sorry, you did not pass. Try again!",
    showAnswers,
    showExplanations,
  };
}
