import { redirect } from "react-router";
import type { Route } from "./+types/courses";
import { getDefaultCourseSlug } from "~/lib/defaultCourse";

export async function loader({}: Route.LoaderArgs) {
  throw redirect(`/courses/${getDefaultCourseSlug()}`);
}

export default function Courses() {
  return null;
}
