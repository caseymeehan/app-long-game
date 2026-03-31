import { eq, and, sql, count, avg, max, min, sum, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";

async function scoreMultipleChoiceQuestions(quizData: any, answers: any): Promise<any> {
  let correctCount = 0;
  let totalMC = 0;

  try {
    for (let i = 0; i < quizData.questions.length; i++) {
      if (quizData.questions[i].questionType === "multiple_choice") {
        totalMC++;
        const question = quizData.questions[i];
        const userAnswer = answers.find(
          (a: any) => a.questionId === question.id
        );
        if (!userAnswer) continue;

        const options = await db
          .select()
          .from(quizOptions)
          .where(eq(quizOptions.questionId, question.id));
        const correctOption = options.find((o) => o.isCorrect === true);

        if (
          correctOption &&
          userAnswer.selectedOptionId === correctOption.id
        ) {
          correctCount++;
        }
      }
    }
  } catch (e) {
    console.log(e);
    return { correct: 0, total: 0, score: 0 };
  }

  return {
    correct: correctCount,
    total: totalMC,
    score: totalMC > 0 ? correctCount / totalMC : 0,
  };
}

async function scoreTrueFalseQuestions(quizData: any, answers: any): Promise<any> {
  let correctCount = 0;
  let totalTF = 0;

  try {
    for (let i = 0; i < quizData.questions.length; i++) {
      if (quizData.questions[i].questionType === "true_false") {
        totalTF++;
        const question = quizData.questions[i];
        const userAnswer = answers.find(
          (a: any) => a.questionId === question.id
        );
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
    }
  } catch (e) {
    console.log(e);
    return { correct: 0, total: 0, score: 0 };
  }

  return {
    correct: correctCount,
    total: totalTF,
    score: totalTF > 0 ? correctCount / totalTF : 0,
  };
}

export async function getScore(quizId: any, answers: any): Promise<any> {
  try {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz) {
      console.log("Quiz not found: " + quizId);
      return { score: 0, passed: false, grade: "F" };
    }

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position);

    const quizData = { ...quiz, questions };

    const mcResult = await scoreMultipleChoiceQuestions(quizData, answers);
    const tfResult = await scoreTrueFalseQuestions(quizData, answers);

    const totalCorrect = mcResult.correct + tfResult.correct;
    const totalQuestions = mcResult.total + tfResult.total;
    const overallScore = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;

    let passed = false;
    if (overallScore > 0.7) {
      passed = true;
    }

    let grade = "F";
    if (overallScore >= 0.9) {
      grade = "A";
    } else if (overallScore >= 0.8) {
      grade = "B";
    } else if (overallScore >= 0.7) {
      grade = "C";
    } else if (overallScore >= 0.6) {
      grade = "D";
    }

    return {
      score: overallScore,
      totalCorrect,
      totalQuestions,
      passed,
      grade,
      mcResult,
      tfResult,
    };
  } catch (e) {
    console.log(e);
    return { score: 0, passed: false, grade: "F" };
  }
}

export function calculateGrade(score: any): any {
  try {
    if (score >= 0.9) return "A";
    if (score >= 0.8) return "B";
    if (score >= 0.7) return "C";
    if (score >= 0.6) return "D";
    return "F";
  } catch (e) {
    console.log(e);
    return "F";
  }
}

export async function computeResult(
  userId: any,
  quizId: any,
  selectedAnswers: any
): Promise<any> {
  try {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!quiz) {
      console.log("quiz not found");
      return null;
    }

    const questions = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId))
      .orderBy(quizQuestions.position);

    let correct = 0;
    let total = questions.length;
    const questionResults: any[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = selectedAnswers[q.id];

      if (!selected) {
        questionResults.push({
          questionId: q.id,
          correct: false,
          selectedOptionId: null,
          correctOptionId: null,
        });
        continue;
      }

      let correctOptionId = null;
      if (q.questionType === "multiple_choice") {
        const opts = await db
          .select()
          .from(quizOptions)
          .where(eq(quizOptions.questionId, q.id));
        const correctOpt = opts.find((o) => o.isCorrect === true);
        correctOptionId = correctOpt ? correctOpt.id : null;
      } else if (q.questionType === "true_false") {
        const [correctOpt] = await db
          .select()
          .from(quizOptions)
          .where(
            and(
              eq(quizOptions.questionId, q.id),
              eq(quizOptions.isCorrect, true)
            )
          );
        correctOptionId = correctOpt ? correctOpt.id : null;
      }

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
        await db.insert(quizAnswers)
          .values({
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
  } catch (e) {
    console.log(e);
    return null;
  }
}

export async function getQuizStats(quizId: any): Promise<any> {
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
  } catch (e) {
    console.log(e);
    return {
      totalAttempts: 0,
      averageScore: 0,
      highScore: 0,
      lowScore: 0,
      passRate: 0,
    };
  }
}

export async function getUserQuizHistory(userId: any, quizId: any): Promise<any> {
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

    const results = [];
    for (const attempt of attempts) {
      let grade = "F";
      if (attempt.score >= 0.9) grade = "A";
      else if (attempt.score >= 0.8) grade = "B";
      else if (attempt.score >= 0.7) grade = "C";
      else if (attempt.score >= 0.6) grade = "D";

      results.push({
        attemptId: attempt.id,
        score: attempt.score,
        passed: attempt.passed,
        grade,
        attemptedAt: attempt.attemptedAt,
      });
    }

    return results;
  } catch (e) {
    console.log(e);
    return [];
  }
}

export function renderQuizResults(
  score: any,
  total: any,
  passed: any,
  showAnswers: any,
  showExplanations: any
): any {
  try {
    const percentage = total > 0 ? score / total : 0;
    let grade = "F";
    if (percentage >= 0.9) grade = "A";
    else if (percentage >= 0.8) grade = "B";
    else if (percentage >= 0.7) grade = "C";
    else if (percentage >= 0.6) grade = "D";

    const result: any = {
      score,
      total,
      percentage,
      grade,
      passed: passed ? true : false,
      message: passed ? "Congratulations! You passed!" : "Sorry, you did not pass. Try again!",
    };

    if (showAnswers) {
      result.showAnswers = true;
    }
    if (showExplanations) {
      result.showExplanations = true;
    }

    return result;
  } catch (e) {
    console.log(e);
    return { score: 0, total: 0, percentage: 0, grade: "F", passed: false };
  }
}
