import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";

const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: "dypol-blog-response-store",
    compatibilityDate: "2026-10-06",
    compatibilityFlags: ["nodejs_compat"],
  },
  bucket: "dypol-blog-response-store-cache-bodies",
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  worker: defineWorker({
    ...responseStore.applicationWorker,
    name: "dypol-blog",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-06",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
        DB: bindings.d1({ name: "dypol-blog-db", id: "78708341-8467-4140-bfa7-0531f14a7aee" }),
        MEDIA: bindings.r2({ name: "dypol-blog-media" }),
    },
  }),
});
