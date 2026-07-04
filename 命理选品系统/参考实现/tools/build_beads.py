#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 AI 生成的原图珠子(beads_raw/<name>.png) 标准化 → 打包进 beads_assets.js。
处理：白底 flood-fill 抠透明 → 裁到珠子外接框(顺带裁掉即梦右下角标) → 正方形留白(珠径~82%)
      → 边缘羽化 → 统一 512²  →  data URI。
缺图的 name 保留 base(现有 beads_assets.js) 里的旧珠 —— 支持"先加 5 颗、其余后补"。

用法：
  python3 build_beads.py --raw beads_raw --base /path/to/beads_assets.js --out /path/to/beads_assets.js
名字(对应系统 key)：nanhong moonstone bluelace citrine clear obsidian silver incense
"""
import os, sys, json, base64, io, argparse
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

NAMES = ['nanhong','moonstone','bluelace','citrine','clear','obsidian','silver','incense']
OUT_SIZE = 512      # 输出正方形边长
BEAD_FRAC = 0.82    # 珠径占画布比例(8 颗一致→串起来大小匀)
SENTINEL = (255, 0, 255)  # 抠底哨兵色(珠子里不会出现的洋红)

def find_raw(raw_dir, name):
    for ext in ('.png','.PNG','.jpg','.jpeg','.webp'):
        p = os.path.join(raw_dir, name+ext)
        if os.path.isfile(p): return p
    return None

def remove_bg_and_crop(path):
    """白底→透明 + 裁到珠子外接框(去掉角标水印) + 正方形留白 + 512²"""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    work = im.copy()
    # 从四角/四边中点 flood-fill 连通白底为哨兵色(thresh 容忍即梦棋盘格/渐变)
    seeds = [(0,0),(w-1,0),(0,h-1),(w-1,h-1),(w//2,0),(w//2,h-1),(0,h//2),(w-1,h//2)]
    for s in seeds:
        try: ImageDraw.floodfill(work, s, SENTINEL, thresh=40)
        except Exception: pass
    arr = np.asarray(work)
    bg = np.all(arr == np.array(SENTINEL), axis=-1)     # True=背景
    alpha = np.where(bg, 0, 255).astype('uint8')
    # 外接框(仅珠子)：裁掉角标水印(在珠外白底上)
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:  # 兜底：整图当珠子
        x0,y0,x1,y1 = 0,0,w,h
    else:
        x0,x1,y0,y1 = xs.min(), xs.max()+1, ys.min(), ys.max()+1
    rgba = np.dstack([np.asarray(im), alpha])
    bead = Image.fromarray(rgba, 'RGBA').crop((x0,y0,x1,y1))
    # 边缘羽化(抗锯齿)
    a = bead.split()[3].filter(ImageFilter.GaussianBlur(0.8))
    bead.putalpha(a)
    # 正方形画布 + 留白让珠径占 BEAD_FRAC
    bw, bh = bead.size
    side = int(round(max(bw, bh) / BEAD_FRAC))
    canvas = Image.new('RGBA', (side, side), (0,0,0,0))
    canvas.paste(bead, ((side-bw)//2, (side-bh)//2), bead)
    return canvas.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)

def to_data_uri(img):
    buf = io.BytesIO(); img.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def load_base(path):
    if not path or not os.path.isfile(path): return {}
    t = open(path, encoding='utf-8').read()
    return json.loads(t[t.index('{'):t.rindex('}')+1])

def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--raw',  default=os.path.join(here, '..', 'beads_raw'))
    ap.add_argument('--base', default='')   # 现有 beads_assets.js(缺图的珠沿用旧图)
    ap.add_argument('--out',  default=os.path.join(here, '..', 'beads_assets.js'))
    ap.add_argument('--preview', default=os.path.join(here, '..', 'beads_raw', 'processed'))
    a = ap.parse_args()
    beads = load_base(a.base)
    os.makedirs(a.preview, exist_ok=True)
    added = []
    for name in NAMES:
        p = find_raw(a.raw, name)
        if not p:
            print(f'  · {name:10s} 无原图 → {"沿用旧珠" if name in beads else "缺失!"}')
            continue
        img = remove_bg_and_crop(p)
        img.save(os.path.join(a.preview, f'bead_{name}.png'))
        beads[name] = to_data_uri(img)
        added.append(name); print(f'  ✓ {name:10s} 处理完成 ← {os.path.basename(p)}')
    missing = [n for n in NAMES if n not in beads]
    if missing: print('  ⚠ 仍缺：', ', '.join(missing))
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write('const BEAD_IMG=' + json.dumps(beads, ensure_ascii=False) + ';\n')
    print(f'\n写出 {a.out}（共 {len(beads)} 颗，本轮新增 {len(added)}：{", ".join(added) or "无"}）')

if __name__ == '__main__':
    main()
