import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    fileParallelism: false,
    env: {
      ...loadEnv("test", process.cwd(), ""),
    },
  },
});
