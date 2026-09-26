import sys
from PIL import Image, ImageDraw
files = sys.argv[2:]; out = sys.argv[1]
ims = [Image.open(f) for f in files]
w, h = ims[0].size
cols = min(4, len(ims)); rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), "black")
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im.convert("RGB"), (x, y))
    ImageDraw.Draw(sheet).text((x + 8, y + 8), f.split("-")[-1], fill="red")
sheet.save(out)
