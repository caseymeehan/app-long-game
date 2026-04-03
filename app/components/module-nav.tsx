import { NavLink } from "react-router";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { ChevronRight, Circle, CheckCircle2 } from "lucide-react";

interface Lesson {
  id: number;
  title: string;
  completed: boolean;
}

interface Module {
  id: number;
  title: string;
  position: number;
  lessons: Lesson[];
}

interface ModuleNavProps {
  modules: Module[];
  courseSlug: string;
}

export function ModuleNav({ modules, courseSlug }: ModuleNavProps) {
  const [expandedModules, setExpandedModules] = useState<Set<number>>(() => {
    // Auto-expand the first module with incomplete lessons
    const first = modules.find((m) =>
      m.lessons.some((l) => !l.completed)
    );
    return new Set(first ? [first.id] : modules[0] ? [modules[0].id] : []);
  });

  function toggleModule(moduleId: number) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  }

  return (
    <div className="space-y-1">
      {modules.map((mod) => {
        const isExpanded = expandedModules.has(mod.id);
        const completedCount = mod.lessons.filter((l) => l.completed).length;
        const totalCount = mod.lessons.length;
        const allComplete = totalCount > 0 && completedCount === totalCount;

        return (
          <div key={mod.id}>
            <button
              onClick={() => toggleModule(mod.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
              <span className="truncate text-left flex-1">{mod.title}</span>
              {totalCount > 0 && (
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    allComplete
                      ? "text-green-500"
                      : "text-sidebar-foreground/40"
                  )}
                >
                  {completedCount}/{totalCount}
                </span>
              )}
            </button>

            {isExpanded && mod.lessons.length > 0 && (
              <div className="ml-3 space-y-0.5 border-l border-sidebar-border pl-3">
                {mod.lessons.map((lesson) => (
                  <NavLink
                    key={lesson.id}
                    to={`/courses/${courseSlug}/lessons/${lesson.id}`}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )
                    }
                  >
                    {lesson.completed ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />
                    ) : (
                      <Circle className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate">{lesson.title}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
