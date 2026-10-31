import { createFileRoute } from "@tanstack/react-router";
import frame01 from "../content/photolab/01.jpg.b64?raw";
import frame02 from "../content/photolab/02.jpg.b64?raw";
import frame03 from "../content/photolab/03.jpg.b64?raw";
import frame04 from "../content/photolab/04.jpg.b64?raw";

const FRAMES: Record<string, string> = {
  "01.jpg": frame01,
  "02.jpg": frame02,
  "03.jpg": frame03,
  "04.jpg": frame04,
};

/** Gallery frames for /photolab. Not linked from the rest of the site. */
export const Route = createFileRoute("/photolab/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const b64 = FRAMES[params.file]?.replace(/\s/g, "");
        if (!b64) return new Response("Not found", { status: 404 });
        const binary = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
        return new Response(binary, {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
