#!/usr/bin/env python3
"""Generate the Omnimodal icon set: the OpenCode glyph with a blue circular O.

Draws the mark at 4x (4096px), downsamples to the 1024 master, and rasterizes
every derivative in this directory (icon.png sizes, the Windows .ico, the mac
.icns, Store logos, Android/iOS launchers). Run from packages/desktop/icons.
"""

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent / "omnimodal"
LOGO = 1024
SS = 4
W = LOGO * SS

# Background squircle gradient (matches the stock OpenCode charcoal).
BG_TOP = (0x38, 0x38, 0x38)
BG_BOTTOM = (0x1B, 0x1B, 0x1B)
# Blue ring gradient for the O.
RING_TOP = (0x64, 0xA0, 0xFF)
RING_BOTTOM = (0x2C, 0x5B, 0xD0)
# Counter (inner disk) two-tone gradient: dark top bar, lighter lower block.
INNER_TOP = (0x23, 0x23, 0x25)
INNER_BOTTOM = (0x4B, 0x46, 0x49)

# Glyph geometry, in 1024 units.
CENTER = 512
RADIUS = 316        # outer radius of the O
STROKE = 140        # ring thickness
BG_RADIUS = 232     # squircle corner radius


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vertical_gradient(size, top, bottom, split=None, split_top=None):
    """Vertical gradient, optionally pinning `top` until `split` then blending to `bottom`."""
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        if split is not None and t < split:
            color = split_top
        elif split is not None:
            color = lerp(split_top, bottom, min(1.0, (t - split) / 0.25))
        else:
            color = lerp(top, bottom, t)
        draw.line([(0, y), (size, y)], fill=color)
    return img


def build_master():
    scale = SS
    cx = cy = CENTER * scale
    bg = vertical_gradient(W, BG_TOP, BG_BOTTOM)

    # Squircle background mask.
    mask = Image.new("L", (W, W), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [0, 0, W - 1, W - 1], radius=BG_RADIUS * scale, fill=255
    )
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    canvas.paste(bg.convert("RGBA"), (0, 0), mask)

    # Soft drop shadow under the glyph, like the stock icon.
    ring_mask = Image.new("L", (W, W), 0)
    ring_draw = ImageDraw.Draw(ring_mask)
    outer, inner = RADIUS * scale, (RADIUS - STROKE) * scale
    ring_draw.ellipse([cx - outer, cy - outer, cx + outer, cy + outer], fill=255)
    ring_draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=0)
    shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    shadow.putalpha(ring_mask.filter(ImageFilter.GaussianBlur(radius=9 * scale)))
    shadow = shadow.transform(
        (W, W), Image.AFFINE, (1, 0, 0, 0, 1, -14 * scale)
    )
    canvas.alpha_composite(shadow)

    # Blue ring with a vertical gradient.
    ring_grad = vertical_gradient(W, RING_TOP, RING_BOTTOM).convert("RGBA")
    canvas.paste(ring_grad, (0, 0), ring_mask)

    # Two-tone inner counter, clipped to the ring's counter.
    disk_mask = Image.new("L", (W, W), 0)
    disk_draw = ImageDraw.Draw(disk_mask)
    disk_draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=255)
    inner_grad = vertical_gradient(W, INNER_TOP, INNER_BOTTOM, split=0.35, split_top=INNER_TOP)
    canvas.paste(inner_grad.convert("RGBA"), (0, 0), disk_mask)

    # Supersampled master down to 1024.
    return canvas.resize((LOGO, LOGO), Image.LANCZOS)


def write_png(img, path):
    img.save(path, format="PNG")


def png_bytes(img, size):
    buf = io.BytesIO()
    resized = img if img.size == (size, size) else img.resize((size, size), Image.LANCZOS)
    resized.save(buf, format="PNG")
    return buf.getvalue()


def build_ico(master):
    sizes = [16, 24, 32, 48, 64, 256]
    images = {size: png_bytes(master, size) for size in sizes}
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    payload = b""
    for size in sizes:
        data = images[size]
        dim = 0 if size == 256 else size
        entries += struct.pack(
            "<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset
        )
        payload += data
        offset += len(data)
    return header + entries + payload


def build_icns(master, info_chunk):
    mapping = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
        (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 1024),
    ]
    body = b""
    for typ, size in mapping:
        data = png_bytes(master, size)
        body += typ + struct.pack(">I", 8 + len(data)) + data
    body += info_chunk
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def read_info_chunk():
    data = (HERE / "icon.icns").read_bytes()
    off = 8
    while off < len(data):
        typ = data[off:off + 4]
        length = struct.unpack(">I", data[off + 4:off + 8])[0]
        if typ == b"info":
            return data[off:off + length]
        off += length
    raise SystemExit("no info chunk in icon.icns")


def main():
    master = build_master()
    write_png(master, HERE.parent / "omnimodal-preview-1024.png")
    master.resize((128, 128), Image.LANCZOS).save(
        HERE.parent / "omnimodal-preview-128.png"
    )
    master.resize((32, 32), Image.LANCZOS).save(
        HERE.parent / "omnimodal-preview-32.png"
    )

    # Every PNG derivative in the set is a full-bleed resize of the master.
    for path in sorted(HERE.rglob("*.png")):
        with Image.open(path) as existing:
            size = existing.size[0]
        master.resize((size, size), Image.LANCZOS).save(path)
        print(f"png {path.relative_to(HERE)} {size}")

    (HERE / "icon.ico").write_bytes(build_ico(master))
    print("ico done")
    (HERE / "icon.icns").write_bytes(build_icns(master, read_info_chunk()))
    print("icns done")


if __name__ == "__main__":
    main()
