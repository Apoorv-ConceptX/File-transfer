import { serve } from "inngest/next";
import { inngest, jobWorker } from "@/lib/inngest";
export const runtime = "nodejs";
export const maxDuration = 300;
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [jobWorker],
});
