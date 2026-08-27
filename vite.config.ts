import { defineConfig } from "vite";

// Plain Vite dev server doesn't run the /api/*.ts serverless functions —
// those only execute under `vercel dev` or once deployed. Run `vercel dev`
// instead of `npm run dev` when you need the real API proxy locally; `npm
// run dev` alone is fine while working against src/lib/mockData.ts.
export default defineConfig({});
