#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Split a generated three-frame horizontal sprite strip into panel images.

The existing sprite-cutout.py deliberately separates figures by transparent
gaps. Generated action strips can put a hand or foot close to the next panel,
so crop the declared three equal panels first, then run sprite-cutout.py on
each crop.

    python tools/sprite-triptych.py <strip.png> <action-direction>
"""

import os
import sys

from PIL import Image

if len(sys.argv) != 3:
    sys.exit(__doc__)

src, base = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, 'tmp', 'sprite-triptychs')
os.makedirs(out_dir, exist_ok=True)

im = Image.open(src).convert('RGBA')
if im.width < 3:
    sys.exit('strip is too narrow to split into three panels')

for i in range(3):
    left = im.width * i // 3
    right = im.width * (i + 1) // 3
    panel = im.crop((left, 0, right, im.height))
    dst = os.path.join(out_dir, '%s-%d.png' % (base, i))
    panel.save(dst)
    print(dst)
