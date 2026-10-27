"""Desenha o ícone do Zeus (relâmpago branco sobre fundo preto) e gera icon.icns e icon.png."""
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
S = 4                       # super-amostragem para contornos suaves
N = 1024 * S
img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# grelha de ícones do macOS: corpo de 824 px dentro de 1024, cantos ~22%
pad = 100 * S
body = N - 2 * pad
d.rounded_rectangle([pad, pad, pad + body, pad + body], radius=int(body * 0.225), fill=(11, 11, 12, 255))
# contorno muito subtil para se ver em fundos escuros
d.rounded_rectangle([pad, pad, pad + body, pad + body], radius=int(body * 0.225), outline=(46, 46, 50, 255), width=3 * S)

# relâmpago (mesmo desenho da interface, caixa de 24 unidades)
import math
pts = [(13.5, 2), (4.5, 13.5), (11, 13.5), (9.5, 22), (19.5, 9.5), (13, 9.5), (13.5, 2)]
# inclinado para a direita (14 graus, no sentido dos ponteiros do relógio)
ang = math.radians(14)
pts = [(12 + (x - 12) * math.cos(ang) - (y - 12) * math.sin(ang), 12 + (x - 12) * math.sin(ang) + (y - 12) * math.cos(ang)) for x, y in pts]
scale = body * 0.62 / 24
ox = pad + (body - 24 * scale) / 2 + scale * 0.0
oy = pad + (body - 24 * scale) / 2
d.polygon([(ox + x * scale, oy + y * scale) for x, y in pts], fill=(246, 246, 244, 255))

final = img.resize((1024, 1024), Image.LANCZOS)
final.save(os.path.join(HERE, 'icon.png'))
final.save(os.path.join(HERE, 'icon.icns'), sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
print('ícone pronto')
