// vite.config.js
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Set VITE_API_ORIGIN in a .env file, for example http://localhost:8787
  const apiOrigin = env.VITE_API_ORIGIN || "http://localhost:8787";

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
      dedupe: ["three"],
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
      hmr: {
        overlay: false, // set true if you want the error overlay back
      },
    },
    // lets /api work when using `vite preview` too
    preview: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    optimizeDeps: {
      include: ["three", "three-stdlib"],
    },
    build: {
      sourcemap: true,
      target: "esnext",
      rollupOptions: {
        // include admin.html in the build
        input: {
          main: path.resolve(__dirname, "index.html"),
          admin: path.resolve(__dirname, "admin.html"),
        },
        output: {
          manualChunks: {
            three: ["three", "three-stdlib"],
          },
        },
      },
    },
  };
});

