# beads_raw · AI 生成的珠子原图放这里

把即梦生成、**每颗选定 1 张**的原图（白底/带角标都行，我会自动处理）放进本目录，**用系统 key 命名**：

```
nanhong.png    南红玛瑙
moonstone.png  月光石
bluelace.png   蓝纹玛瑙
citrine.png    黄水晶
clear.png      白水晶
obsidian.png   黑曜石
silver.png     银隔珠
incense.png    静心香珠(沉香)
```

- 只放一部分也行（如先放 5 颗），缺的会**沿用现有旧珠**，等补齐再替换。
- 提交推送后，跑 `tools/build_beads.py`：自动**抠白底→透明、裁到珠子(顺带去掉右下角"即梦AI"角标)、正方形留白(珠径~82%)、统一 512²**，打包进 `beads_assets.js`，再重灌进 P0 与 3D 星盘页。
- 处理后的预览图会落在 `beads_raw/processed/`。
