import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
  QuestionType,
} from "~/db/schema";

// ─── Quiz Service ───
// Handles quiz CRUD, question/option management, and attempt recording.

// ─── Quiz CRUD ───

export async function getQuizById(id: number) {
  const [row] = await db.select().from(quizzes).where(eq(quizzes.id, id));
  return row;
}

export async function getQuizByLessonId(lessonId: number) {
  const [row] = await db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId));
  return row;
}

export async function getQuizWithQuestions(quizId: number) {
  const quiz = await getQuizById(quizId);
  if (!quiz) return null;

  const questions = await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position);

  const questionsWithOptions = await Promise.all(
    questions.map(async (question) => {
      const options = await db
        .select()
        .from(quizOptions)
        .where(eq(quizOptions.questionId, question.id));
      return { ...question, options };
    })
  );

  return { ...quiz, questions: questionsWithOptions };
}

export async function createQuiz(
  lessonId: number,
  title: string,
  passingScore: number
) {
  const [row] = await db
    .insert(quizzes)
    .values({ lessonId, title, passingScore })
    .returning();
  return row;
}

export async function updateQuiz(
  id: number,
  title: string | null,
  passingScore: number | null
) {
  const updates: Record<string, unknown> = {};
  if (title !== null) updates.title = title;
  if (passingScore !== null) updates.passingScore = passingScore;

  if (Object.keys(updates).length === 0) {
    return await getQuizById(id);
  }

  const [row] = await db
    .update(quizzes)
    .set(updates)
    .where(eq(quizzes.id, id))
    .returning();
  return row;
}

export async function deleteQuiz(id: number) {
  // Cascade: delete answers -> attempts -> options -> questions -> quiz
  const questions = await getQuestionsByQuiz(id);
  for (const question of questions) {
    await db.delete(quizOptions).where(eq(quizOptions.questionId, question.id));
  }

  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, id));
  for (const attempt of attempts) {
    await db.delete(quizAnswers).where(eq(quizAnswers.attemptId, attempt.id));
  }

  await db.delete(quizAttempts).where(eq(quizAttempts.quizId, id));
  await db.delete(quizQuestions).where(eq(quizQuestions.quizId, id));
  const [row] = await db.delete(quizzes).where(eq(quizzes.id, id)).returning();
  return row;
}

// ─── Question Management ───

export async function getQuestionById(id: number) {
  const [row] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, id));
  return row;
}

export async function getQuestionsByQuiz(quizId: number) {
  return await db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position);
}

export async function getQuestionCount(quizId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));
  return Number(result?.count ?? 0);
}

export async function createQuestion(opts: {
  quizId: number;
  questionText: string;
  questionType: QuestionType;
  position: number | null;
}) {
  const { quizId, questionText, questionType, position } = opts;
  let pos: number;
  if (position !== null) {
    pos = position;
  } else {
    const [maxResult] = await db
      .select({
        max: sql<number>`coalesce(max(${quizQuestions.position}), 0)`,
      })
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, quizId));
    pos = (maxResult?.max ?? 0) + 1;
  }

  const [row] = await db
    .insert(quizQuestions)
    .values({ quizId, questionText, questionType, position: pos })
    .returning();
  return row;
}

export async function updateQuestion(
  id: number,
  questionText: string | null,
  questionType: QuestionType | null
) {
  const updates: Record<string, unknown> = {};
  if (questionText !== null) updates.questionText = questionText;
  if (questionType !== null) updates.questionType = questionType;

  if (Object.keys(updates).length === 0) {
    return await getQuestionById(id);
  }

  const [row] = await db
    .update(quizQuestions)
    .set(updates)
    .where(eq(quizQuestions.id, id))
    .returning();
  return row;
}

export async function deleteQuestion(id: number) {
  await db.delete(quizOptions).where(eq(quizOptions.questionId, id));
  const [row] = await db
    .delete(quizQuestions)
    .where(eq(quizQuestions.id, id))
    .returning();
  return row;
}

// ─── Question Reordering ───

export async function moveQuestionToPosition(opts: {
  questionId: number;
  newPosition: number;
}) {
  const { questionId, newPosition } = opts;
  const question = await getQuestionById(questionId);
  if (!question) return null;

  const oldPosition = question.position;
  if (oldPosition === newPosition) return question;

  if (newPosition > oldPosition) {
    await db.update(quizQuestions)
      .set({ position: sql`${quizQuestions.position} - 1` })
      .where(
        and(
          eq(quizQuestions.quizId, question.quizId),
          sql`${quizQuestions.position} > ${oldPosition}`,
          sql`${quizQuestions.position} <= ${newPosition}`
        )
      );
  } else {
    await db.update(quizQuestions)
      .set({ position: sql`${quizQuestions.position} + 1` })
      .where(
        and(
          eq(quizQuestions.quizId, question.quizId),
          sql`${quizQuestions.position} >= ${newPosition}`,
          sql`${quizQuestions.position} < ${oldPosition}`
        )
      );
  }

  const [row] = await db
    .update(quizQuestions)
    .set({ position: newPosition })
    .where(eq(quizQuestions.id, questionId))
    .returning();
  return row;
}

export async function reorderQuestions(quizId: number, questionIds: number[]) {
  for (let i = 0; i < questionIds.length; i++) {
    await db.update(quizQuestions)
      .set({ position: i + 1 })
      .where(
        and(
          eq(quizQuestions.id, questionIds[i]),
          eq(quizQuestions.quizId, quizId)
        )
      );
  }
  return await getQuestionsByQuiz(quizId);
}

// ─── Option Management ───

export async function getOptionById(id: number) {
  const [row] = await db.select().from(quizOptions).where(eq(quizOptions.id, id));
  return row;
}

export async function getOptionsByQuestion(questionId: number) {
  return await db
    .select()
    .from(quizOptions)
    .where(eq(quizOptions.questionId, questionId));
}

export async function createOption(
  questionId: number,
  optionText: string,
  isCorrect: boolean
) {
  const [row] = await db
    .insert(quizOptions)
    .values({ questionId, optionText, isCorrect })
    .returning();
  return row;
}

export async function updateOption(
  id: number,
  optionText: string | null,
  isCorrect: boolean | null
) {
  const updates: Record<string, unknown> = {};
  if (optionText !== null) updates.optionText = optionText;
  if (isCorrect !== null) updates.isCorrect = isCorrect;

  if (Object.keys(updates).length === 0) {
    return await getOptionById(id);
  }

  const [row] = await db
    .update(quizOptions)
    .set(updates)
    .where(eq(quizOptions.id, id))
    .returning();
  return row;
}

export async function deleteOption(id: number) {
  const [row] = await db.delete(quizOptions).where(eq(quizOptions.id, id)).returning();
  return row;
}

// ─── Attempt Recording ───

export async function getAttemptById(id: number) {
  const [row] = await db.select().from(quizAttempts).where(eq(quizAttempts.id, id));
  return row;
}

export async function getAttemptsByUser(userId: number, quizId: number) {
  return await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.attemptedAt));
}

export async function getAttemptCountForQuiz(quizId: number) {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, quizId));
  return Number(result?.count ?? 0);
}

export async function getBestAttempt(userId: number, quizId: number) {
  const [row] = await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1);
  return row;
}

export async function getLatestAttempt(userId: number, quizId: number) {
  const [row] = await db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.attemptedAt))
    .limit(1);
  return row;
}

export async function recordAttempt(opts: {
  userId: number;
  quizId: number;
  score: number;
  passed: boolean;
}) {
  const { userId, quizId, score, passed } = opts;
  const [row] = await db
    .insert(quizAttempts)
    .values({ userId, quizId, score, passed })
    .returning();
  return row;
}

export async function recordAnswer(opts: {
  attemptId: number;
  questionId: number;
  selectedOptionId: number;
}) {
  const { attemptId, questionId, selectedOptionId } = opts;
  const [row] = await db
    .insert(quizAnswers)
    .values({ attemptId, questionId, selectedOptionId })
    .returning();
  return row;
}

export async function getAnswersByAttempt(attemptId: number) {
  return await db
    .select()
    .from(quizAnswers)
    .where(eq(quizAnswers.attemptId, attemptId));
}

export async function getAttemptWithAnswers(attemptId: number) {
  const attempt = await getAttemptById(attemptId);
  if (!attempt) return null;

  const answers = await getAnswersByAttempt(attemptId);
  return { ...attempt, answers };
}
