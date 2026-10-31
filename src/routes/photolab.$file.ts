import { createFileRoute } from "@tanstack/react-router";

const PARTS: Record<string, number> = {
  "01.jpg": 9,
  "02.jpg": 7,
  "03.jpg": 11,
  "04.jpg": 7,
};

const RAW = "https://raw.githubusercontent.com/rstmcsoch/dypol-blog/main/src/content/photolab";

/** Gallery frames for /photolab. Not linked from the rest of the site. */
export const Route = createFileRoute("/photolab/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const count = PARTS[params.file];
        if (!count) return new Response("Not found", { status: 404 });
        const stem = params.file.replace(/\.jpg$/, "");
        const pieces = await Promise.all(
          Array.from({ length: count }, (_, index) => {
            const name = `${stem}.jpg.${String(index).padStart(2, "0")}.txt`;
            return fetch(`${RAW}/${name}`, { headers: { "user-agent": "dypol-blog" } }).then(async (response) => {
              if (!response.ok) throw new Error(name);
              return response.text();
            });
          }),
        );
        const binary = Uint8Array.from(atob(pieces.join("").replace(/\s/g, "")), (char) => char.charCodeAt(0));
        return new Response(binary, {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
