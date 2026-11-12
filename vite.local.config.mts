import { mergeConfig } from "vite";
import base from "./vite.config";
export default async (env: unknown) => {
  const cfg = typeof base === "function" ? await (base as (e: unknown) => unknown)(env) : base;
  return mergeConfig(cfg as never, { server: { fs: { allow: ["/workspace/t195/events", "/workspace/dypol-blog/node_modules"] } } });
};
