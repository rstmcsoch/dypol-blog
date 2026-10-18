"""Generate photo-like fixtures and measure pipeline-spec WebP sizes.

Local proxy measurement: PIL/libwebp encodes the same variant specs the
Cloudflare IMAGES binding applies in production (fit inside box, never
upscale, WebP q82 hero / q78 thumb, one retry at q70/q64 when over the
soft byte target). Absolute bytes differ slightly from Cloudflare's
encoder; sizes/targets are indicative, not a prod guarantee.
"""
import io, os, random
from PIL import Image, ImageDraw, ImageFilter

OUT = "/tmp/imgfix"
random.seed(60)

def photo(w, h, path, fmt, quality=92):
    # Photo-like: gradient sky + noisy textured foreground blocks.
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / h
        for x in range(0, w, 4):
            r = int(70 + 90 * t + random.randint(-14, 14))
            g = int(110 + 60 * (1 - t) + random.randint(-14, 14))
            b = int(170 - 80 * t + random.randint(-14, 14))
            for dx in range(4):
                if x + dx < w: px[x + dx, y] = (max(0,min(255,r)), max(0,min(255,g)), max(0,min(255,b)))
    d = ImageDraw.Draw(img)
    for _ in range(260):
        x, y = random.randint(0, w-80), random.randint(h//2, h-40)
        d.rectangle([x, y, x+random.randint(10,80), y+random.randint(8,40)],
                    fill=(random.randint(20,235), random.randint(20,235), random.randint(20,235)))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(path, fmt, quality=quality)
    return os.path.getsize(path)

def variant(img, spec_w, spec_h, q, retry_q, soft):
    scale = min(1, spec_w / img.width, spec_h / img.height)
    size = (max(1, round(img.width*scale)), max(1, round(img.height*scale)))
    resized = img.resize(size, Image.LANCZOS) if scale < 1 else img.copy()
    buf = io.BytesIO(); resized.save(buf, "WEBP", quality=q)
    data = buf.getvalue(); used = q
    if len(data) > soft:
        buf = io.BytesIO(); resized.save(buf, "WEBP", quality=retry_q)
        if len(buf.getvalue()) < len(data): data, used = buf.getvalue(), retry_q
    return size, len(data), used, len(data) > soft

cases = [
    ("phone-photo-2400x1350.jpg", 2400, 1350, "JPEG"),
    ("screenshot-1920x1080.png", 1920, 1080, "PNG"),
    ("small-800x450.jpg", 800, 450, "JPEG"),
]
print(f"{'fixture':28} {'orig KB':>9} {'hero':>22} {'thumb':>22}")
tot_o = tot_h = tot_t = 0
for name, w, h, fmt in cases:
    p = os.path.join(OUT, name)
    orig = photo(w, h, p, fmt)
    img = Image.open(p)
    hs, hero, hq, hover = variant(img, 1280, 720, 82, 70, 200_000)
    ts, thumb, tq, tover = variant(img, 480, 360, 78, 64, 60_000)
    tot_o += orig; tot_h += hero; tot_t += thumb
    print(f"{name:28} {orig/1024:9.1f} {str(hs)+' q'+str(hq):>14} {hero/1024:6.1f}KB{' OVER' if hover else ''} {str(ts)+' q'+str(tq):>14} {thumb/1024:6.1f}KB{' OVER' if tover else ''}")
n = len(cases)
print(f"\navg original {tot_o/n/1024:.1f} KB | avg hero {tot_h/n/1024:.1f} KB | avg thumb {tot_t/n/1024:.1f} KB")
print(f"per-article R2 stored (hero+thumb): {(tot_h+tot_t)/n/1024:.1f} KB avg vs {(tot_o)/n/1024:.1f} KB avg original-only")
print(f"7 published articles at avg: {(tot_h+tot_t)*7/1024/1024:.2f} MB stored")
