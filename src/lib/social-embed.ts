/**
 * t135: social embeds. A paragraph that is ONLY a link to a supported social post
 * (bare URL, <url>, or [label](url)) renders as an embed. Links inside sentences stay links.
 * Everything is rebuilt from a strict allowlist + parsed ids; article text never supplies HTML or scripts.
 */
export type EmbedKind = "iframe" | "script";
export type SocialEmbed = {
  provider: "youtube" | "vimeo" | "spotify" | "x" | "instagram" | "tiktok" | "facebook" | "threads";
  label: string;
  url: string; // canonical public URL (fallback link)
  kind: EmbedKind;
  src?: string; // iframe src
  aspect?: "16/9" | "9/16" | "audio" | "audio-lg" | "post";
};

const LONE_LINK = /^\s*(?:<\s*(https?:\/\/\S+?)\s*>|\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)\s*\)|(https?:\/\/\S+))\s*$/i;

export function loneUrl(text: string): string | null {
  const m = LONE_LINK.exec(text ?? "");
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

function host(u: URL): string {
  return u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
}

const ID = /^[A-Za-z0-9_-]+$/;

export function parseEmbed(text: string): SocialEmbed | null {
  const raw = loneUrl(text);
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.replace(/[.,;:!?]+$/, "")); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = host(u);
  const parts = u.pathname.split("/").filter(Boolean);

  // YouTube
  if (h === "youtube.com" || h === "music.youtube.com" || h === "youtu.be" || h === "youtube-nocookie.com") {
    let id: string | null = null;
    let shorts = false;
    if (h === "youtu.be") id = parts[0] ?? null;
    else if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(parts[0] ?? "")) { id = parts[1] ?? null; shorts = parts[0] === "shorts"; }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    const start = t ? Number.parseInt(t, 10) : 0;
    return {
      provider: "youtube", label: "YouTube", kind: "iframe", aspect: shorts ? "9/16" : "16/9",
      url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      src: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start > 0 ? `&start=${start}` : ""}`,
    };
  }
  // Vimeo
  if (h === "vimeo.com" || h === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{5,12}$/.test(p));
    if (!id) return null;
    return { provider: "vimeo", label: "Vimeo", kind: "iframe", aspect: "16/9", url: `https://vimeo.com/${id}`, src: `https://player.vimeo.com/video/${id}?dnt=1` };
  }
  // Spotify
  if (h === "open.spotify.com") {
    const p = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    const [type, id] = p;
    if (!["track", "album", "playlist", "episode", "show", "artist"].includes(type ?? "") || !id || !ID.test(id)) return null;
    return {
      provider: "spotify", label: "Spotify", kind: "iframe", aspect: type === "track" || type === "episode" ? "audio" : "audio-lg",
      url: `https://open.spotify.com/${type}/${id}`, src: `https://open.spotify.com/embed/${type}/${id}`,
    };
  }
  // X / Twitter
  if (h === "x.com" || h === "twitter.com") {
    const i = parts.indexOf("status");
    const user = parts[0];
    const id = i > 0 ? parts[i + 1] : undefined;
    if (!user || !id || !/^\d{5,25}$/.test(id) || !ID.test(user)) return null;
    return { provider: "x", label: "X", kind: "script", aspect: "post", url: `https://twitter.com/${user}/status/${id}` };
  }
  // Instagram
  if (h === "instagram.com") {
    const i = parts.findIndex((p) => p === "p" || p === "reel" || p === "reels" || p === "tv");
    const id = i >= 0 ? parts[i + 1] : undefined;
    if (!id || !ID.test(id)) return null;
    const kind = parts[i] === "reels" ? "reel" : parts[i];
    return { provider: "instagram", label: "Instagram", kind: "script", aspect: "post", url: `https://www.instagram.com/${kind}/${id}/` };
  }
  // TikTok
  if (h === "tiktok.com") {
    const i = parts.indexOf("video");
    const user = parts[0];
    const id = i > 0 ? parts[i + 1] : undefined;
    if (!user?.startsWith("@") || !ID.test(user.slice(1).replace(/\./g, "_")) || !id || !/^\d{5,25}$/.test(id)) return null;
    return { provider: "tiktok", label: "TikTok", kind: "script", aspect: "post", url: `https://www.tiktok.com/${user}/video/${id}` };
  }
  // Threads
  if (h === "threads.net" || h === "threads.com") {
    const user = parts[0];
    const i = parts.indexOf("post");
    const id = i > 0 ? parts[i + 1] : undefined;
    if (!user?.startsWith("@") || !id || !ID.test(id) || !/^@[A-Za-z0-9._]+$/.test(user)) return null;
    return { provider: "threads", label: "Threads", kind: "script", aspect: "post", url: `https://www.threads.net/${user}/post/${id}` };
  }
  // Facebook post / video (official iframe plugin, no SDK)
  if (h === "facebook.com" || h === "fb.watch") {
    const path = u.pathname;
    const video = /\/videos\/|\/reel\/|^\/watch/.test(path) || h === "fb.watch";
    const post = /\/posts\/|\/permalink\.php|\/photo|story\.php/.test(path);
    if (!video && !post) return null;
    const clean = `https://www.facebook.com${path}${u.search}`.replace(/[<>"']/g, "");
    const target = h === "fb.watch" ? raw : clean;
    const plugin = video ? "video" : "post";
    return {
      provider: "facebook", label: "Facebook", kind: "iframe", aspect: video ? "16/9" : "post",
      url: target, src: `https://www.facebook.com/plugins/${plugin}.php?href=${encodeURIComponent(target)}&show_text=${video ? "false" : "true"}&width=500`,
    };
  }
  return null;
}

/** Script-based providers: the only scripts loaded, always by site code. */
export const EMBED_SCRIPTS: Partial<Record<SocialEmbed["provider"], string>> = {
  x: "https://platform.twitter.com/widgets.js",
  instagram: "https://www.instagram.com/embed.js",
  tiktok: "https://www.tiktok.com/embed.js",
  threads: "https://www.threads.net/embed.js",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Static blockquote markup the provider script upgrades; the link inside is the readable fallback. */
export function embedBlockquote(e: SocialEmbed, theme: "light" | "dark"): string {
  const u = esc(e.url);
  const link = `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">View this post on ${esc(e.label)} ↗</a>`;
  switch (e.provider) {
    case "x": return `<blockquote class="twitter-tweet" data-dnt="true" data-theme="${theme}"><p>${link}</p></blockquote>`;
    case "instagram": return `<blockquote class="instagram-media" data-instgrm-permalink="${u}" data-instgrm-version="14"><p>${link}</p></blockquote>`;
    case "tiktok": {
      const id = e.url.split("/").pop() ?? "";
      return `<blockquote class="tiktok-embed" cite="${u}" data-video-id="${esc(id)}"><section>${link}</section></blockquote>`;
    }
    case "threads": return `<blockquote class="text-post-media" data-text-post-permalink="${u}" data-text-post-version="0"><p>${link}</p></blockquote>`;
    default: return `<p>${link}</p>`;
  }
}
