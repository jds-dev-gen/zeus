"""Desenha o ícone do Olimpo (templo em azul #7cc8f5 sobre o fundo escuro com as três luzes) e gera icon.icns, icon.png e drag.png."""
from PIL import Image, ImageDraw, ImageFilter
import io
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
S = 4                       # super-amostragem para contornos suaves
N = 1024 * S
pad = 100 * S
body = N - 2 * pad

# fundo: #04060a com as três luzes (azul-petróleo, violeta, verde)
bg = Image.new('RGBA', (N, N), (4, 6, 10, 255))
glow = Image.new('RGBA', (N, N), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
for (cx, cy, r, col) in [(0.30, 0.28, 0.42, (32, 128, 170, 150)), (0.80, 0.70, 0.40, (88, 82, 170, 120)), (0.45, 0.95, 0.35, (40, 140, 110, 90))]:
    g.ellipse([N * (cx - r), N * (cy - r), N * (cx + r), N * (cy + r)], fill=col)
glow = glow.filter(ImageFilter.GaussianBlur(N * 0.12))
bg = Image.alpha_composite(bg, glow)

mask = Image.new('L', (N, N), 0)
ImageDraw.Draw(mask).rounded_rectangle([pad, pad, pad + body, pad + body], radius=int(body * 0.225), fill=255)
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
img.paste(bg, (0, 0), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle([pad, pad, pad + body, pad + body], radius=int(body * 0.225), outline=(255, 255, 255, 40), width=3 * S)

# templo (o mesmo desenho da interface, caixa de 24 unidades)
scale = body * 0.56 / 24
ox = pad + (body - 24 * scale) / 2
oy = pad + (body - 24 * scale) / 2 - scale * 0.4
w = int(1.7 * scale)
col = (124, 200, 245, 255)
P = lambda x, y: (ox + x * scale, oy + y * scale)
lines = [[(3, 9), (12, 4), (21, 9)], [(5, 9), (5, 18)], [(9, 9), (9, 18)], [(15, 9), (15, 18)], [(19, 9), (19, 18)], [(3, 21), (21, 21)], [(3, 18), (21, 18)]]
for ln in lines:
    pts = [P(*p) for p in ln]
    d.line(pts, fill=col, width=w, joint='curve')
    for p in pts:
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=col)

final = img.resize((1024, 1024), Image.LANCZOS)
final.save(os.path.join(HERE, 'icon.png'))
final.resize((64, 64), Image.LANCZOS).save(os.path.join(HERE, 'drag.png'))

# .icns feito à mão (só entradas PNG, que o macOS aceita desde o 10.7)
entries = [(b'icp4', 16), (b'icp5', 32), (b'icp6', 64), (b'ic07', 128), (b'ic08', 256), (b'ic09', 512), (b'ic10', 1024), (b'ic11', 32), (b'ic12', 64), (b'ic13', 256), (b'ic14', 512)]
chunks = b''
for kind, px in entries:
    buf = io.BytesIO()
    final.resize((px, px), Image.LANCZOS).save(buf, 'PNG')
    data = buf.getvalue()
    chunks += kind + struct.pack('>I', len(data) + 8) + data
with open(os.path.join(HERE, 'icon.icns'), 'wb') as f:
    f.write(b'icns' + struct.pack('>I', len(chunks) + 8) + chunks)
print('icon.png, drag.png e icon.icns prontos')
