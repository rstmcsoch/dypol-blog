import { createFileRoute } from "@tanstack/react-router";

/** Webpushr service worker. Must be served at /webpushr-sw.js (site root). */
const BODY = "importScripts('https://cdn.webpushr.com/sw-server.min.js');\n";

export const Route = createFileRoute("/webpushr-sw.js")({
  server: {
    handlers: {
      GET: () =>
        new Response(BODY, {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "public, max-age=0, must-revalidate",
            "service-worker-allowed": "/",
          },
        }),
    },
  },
});
