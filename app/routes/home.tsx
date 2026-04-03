import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { getCurrentUserId } from "~/lib/session";
import { getDefaultCourseSlug } from "~/lib/defaultCourse";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AI for the Long Game" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (currentUserId) {
    throw redirect(`/courses/${getDefaultCourseSlug()}`);
  }
  throw redirect("/login");
}

export default function Home() {
  return null;
}
