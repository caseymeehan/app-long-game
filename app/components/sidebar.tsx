import { NavLink, Form } from "react-router";
import { useState, useEffect } from "react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";
import { UserAvatar } from "~/components/user-avatar";
import { ModuleNav } from "~/components/module-nav";
import {
  Shield,
  Tag,
  Users,
  Moon,
  Sun,
  LogOut,
  Settings,
  Layers,
} from "lucide-react";

interface CurrentUser {
  id: number;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
}

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

interface SidebarProps {
  currentUser: CurrentUser;
  courseSlug: string;
  courseTitle: string;
  modules: Module[];
}

export function Sidebar({
  currentUser,
  courseSlug,
  courseTitle,
  modules,
}: SidebarProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleDarkMode() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("long-game-theme", next ? "dark" : "light");
    } catch {}
  }

  const isAdmin = currentUser.role === UserRole.Admin;

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <NavLink to="/" className="text-base font-bold tracking-tight">
          {courseTitle}
        </NavLink>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ModuleNav modules={modules} courseSlug={courseSlug} />

        {isAdmin && (
          <div className="mt-6 border-t border-sidebar-border pt-4">
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Admin
            </div>
            <div className="space-y-1">
              <NavLink
                to="/admin/users"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Users className="size-4" />
                Manage Users
              </NavLink>
              <NavLink
                to="/admin/courses"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Layers className="size-4" />
                Manage Courses
              </NavLink>
              <NavLink
                to="/admin/categories"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <Tag className="size-4" />
                Categories
              </NavLink>
            </div>
          </div>
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-1">
        <button
          onClick={toggleDarkMode}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {isDark ? "Light Mode" : "Dark Mode"}
        </button>

        <div className="flex items-center gap-3 rounded-md px-3 py-2">
          <UserAvatar
            name={currentUser.name}
            avatarUrl={currentUser.avatarUrl}
          />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium">
              {currentUser.name}
            </div>
            <div className="truncate text-xs capitalize text-sidebar-foreground/50">
              {currentUser.role}
            </div>
          </div>
          <NavLink
            to="/settings"
            title="Settings"
            className="rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings className="size-4" />
          </NavLink>
          <Form method="post" action="/api/logout">
            <button
              type="submit"
              title="Sign out"
              className="rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </Form>
        </div>
      </div>
    </aside>
  );
}
