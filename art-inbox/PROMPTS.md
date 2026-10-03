# 乱斗剧场 · 新界面美术素材提示词包 v2

界面方向：**暗色广播控制台**。终末地的精密工业感（45° 切角面板、细线框、技术标注、警示条）加绝区零的街头直播感（斜切、半调网点、胶片噪点、速度线、强对比）。底色近黑，文字骨白，主色信号黄 `#FFE81A`，警示红 `#FF3B3B`，科技青 `#35E1FF`；五位角色各带自己的主题色，选人时整个界面随之换色。

**分工**：AI 只画代码画不出来的**背景和纹理**；面板、按钮、血条、图标、文字全部由代码绘制，任何分辨率下边缘都锐利。所以每条提示词都禁止出现文字、人物和界面元素。角色立绘、头像、大招半身像沿用现有图片，不需要重做。

## 怎么用

1. 把下面的 **Prompt** 整段复制给生图模型，每条都是完整的，不用再拼接别的内容。
2. 每条出 3 到 4 张，按“验收”清单挑最符合的一张。
3. 按“文件名”保存到本目录 `art-inbox/`，png、jpg、webp 都行，**文件名必须完全一致**（例如 `bg-menu.png`）。
4. 放好后告诉我“素材放好了”。我会运行处理脚本、接入界面并截图给你看；不满意就告诉我哪里不对，我改提示词或代码。想自己先看缺哪些：`python scripts/prepare-ui-art.py --check`。

**建议分三轮出图**，每轮放好就告诉我，方向不对能尽早纠正：

| 轮次 | 出哪些 | 为什么先出它们 |
| --- | --- | --- |
| 第一轮 | `bg-menu`、`bg-arena-a`、`emblem` | 决定整体色调和气质，视觉变化最大 |
| 第二轮 | `fx-grunge`、`fx-speed` | 印刷质感与动态感，依赖第一轮的色调 |
| 第三轮 | `bg-arena-b`、`fx-burst`、`deco-shards`、`deco-marks` | 锦上添花，缺了也完整 |

缺哪张，界面就自动使用代码绘制的备用效果（暗色网格背景、原有哥特舞台），不会缺图。

| 文件名 | 比例 | 用在哪里 | 接入状态 |
| --- | --- | --- | --- |
| `bg-menu` | 16:9 | 主菜单与双人房间的全屏背景 | 已接入 |
| `bg-arena-a` | 16:9 | 战斗舞台背景一（替换哥特舞台） | 已接入 |
| `bg-arena-b` | 16:9 | 战斗舞台背景二，与一按局轮换 | 已接入 |
| `fx-grunge` | 16:9 | 全局半调、划痕、噪点叠层 | 已接入 |
| `fx-speed` | 16:9 | 开场对阵画面的速度线 | 已接入 |
| `fx-burst` | 1:1 | K.O. 字样身后的红色冲击爆裂 | 已接入 |
| `emblem` | 1:1 | 左上角标志、空座位图案 | 已接入 |
| `deco-shards` | 3:2 | 角色身后的碎片色块（图集，自动切成单图） | 已切图，先用第 1 张；看到成品再决定用法 |
| `deco-marks` | 3:2 | 条码、箭头、准星等贴纸（图集，自动切成单图） | 已切图；看到成品再布置位置 |

## 通用说明

- **分辨率**：16:9 的图尽量出 2560×1440，至少 1920×1080。模型只支持 1:1 或 3:2 时也可以，把重要内容放在中间，我来裁切。
- **纯黑底素材**（`fx-*`、`emblem`、`deco-*`）：背景要纯黑 `#000000`，图案白色或浅灰。脚本把亮度转成透明度，再由代码染成任意颜色，所以颜色不用管；底不够黑也会自动压黑，但越黑越干净。
- **提示词很长是有意的**：每段都在约束位置和比例。如果你的模型对长度敏感（例如 Midjourney 有效词数很少），保留 `Scene` 和 `Composition` 两段，其余删掉。
- **想强化风格时**（可选，追加到提示词末尾）：`Art direction reference: modern Chinese gacha action-game environment art, in the vein of Zenless Zone Zero and Arknights: Endfield.`
- **Midjourney、Stable Diffusion 一类**：加 `--ar 16:9`（方图 `--ar 1:1`，3:2 `--ar 3:2`），并把每条末尾 `Strictly no ...` 那句挪到负面提示词或 `--no` 参数里。
- **模型总在画文字或人物**：把 `Strictly no ...` 那句挪到句首再试一次，或用负面提示词。

---

## A1 · `bg-menu` — 主菜单、房间背景

16:9。角色立绘会站在画面**左侧约 33%–40% 宽度**处，选人面板盖住右侧约 30%，所以：**拱形大窗的中心放在约 38% 宽度**，让角色正好站在窗光里；窗下是一块留给角色的空地；右侧三分之一暗而安静。手机竖屏只显示这张图中间约 25% 宽的一条（以 30% 处为中心），这条里要有窗光和空地。

**Prompt**

```text
Wide cinematic 16:9 establishing shot, 2D anime action-game environment art: cel-shaded shapes with soft painterly gradients, crisp edges, rich atmospheric haze. No characters.

Scene: the interior of a decommissioned steel foundry converted into an underground live-music fight arena, seen from the audience pit at a slightly low angle, looking toward a raised stage far away. A monumental black-steel gothic pointed-arch window dominates the far wall, glowing pale cyan-white, with a large crescent moon visible through it. Massive riveted steel trusses, crane rails and hanging stage-light rigs span overhead. Narrow beams of signal-yellow and cold-cyan light cut diagonally through drifting haze and floating dust. Yellow-and-black hazard stripes are painted on the concrete floor and along the stage edge. Silhouetted flight cases, amplifier stacks and thick cables line both sides. Rain streaks glint on high skylights, thin steam rises from floor vents, and one small hot-red neon sign (an abstract shape, no letters) glows in the far corner.

Composition: the arched window is centered at about 38% of the image width, slightly left of center, and its pale light falls on an open, clear stretch of floor directly below it (about 20% to 55% of the width, in the lower half of the frame). Keep that floor area completely free of objects, because a character will be placed there later. The right 30% of the frame is darker, calmer and low in detail (shadowed machinery and haze) so that interface panels can sit on top. Strong depth: sharp midground, softly blurred extreme foreground edges. The bottom 12% of the frame is the dark floor receding.

Palette: deep blue-black shadows (#07080C to #151821), signal yellow (#FFE81A) highlights, cold cyan (#35E1FF) rim light, tiny hot-red (#FF3B3B) accents. Dark and moody, high contrast, with the open floor area still readable.

Strictly no people, no characters, no creatures, no text, no letters, no numbers, no logos, no watermark, no frame or border, no user-interface elements.
```

**验收**
- 拱窗在画面偏左（约 38%），窗下有一块干净的空地，没有杂物。
- 右侧三分之一明显更暗、更简单。
- 画面里没有任何文字、数字、人物。
- 整体偏暗，黄和青是点缀光，不是大面积颜色。

---

## A2 · `bg-arena-a` — 战斗舞台一

16:9，**侧视、正对、无透视**。游戏里角色脚踩的线在画面高度的 **83.6%** 处，地面和边缘线的位置必须准，我已经验证过：图里画在这个高度的亮线，在游戏里恰好落在角色脚下。顶部约 18% 会被血条压暗、底部约 16% 会被按键压暗，别把重要细节放在那两条。

**Prompt**

```text
2D side-scrolling fighting-game stage background, 16:9, straight-on orthographic view at eye level, with no perspective tilt, like a flat stage set seen from the audience. Anime action-game environment art: cel-shaded shapes with soft painterly gradients and crisp edges.

Layout, measured from the top of the image (very important):
- 0% to 66%: the back wall and set. In the center, a huge circular rose-window made of black steel and glass with a glowing crescent moon inside it, pale cyan-white light. On both sides, tall pointed-arch steel-framed industrial windows with a warm yellow glow. At the far left and far right edges, riveted steel pillars and pipes. Across the very top, a dark truss with a row of stage lights casting soft beams of yellow and cyan.
- 66% to 100%: a wide, perfectly flat, perfectly horizontal stage floor of dark reflective concrete spanning the full width. A thin bright yellow-white edge line runs along the floor at 83.6% from the top, with yellow-and-black hazard stripes just below it. A faint painted ring marking sits in the middle of the floor. Soft reflections of the lights, light scuffs and hairline cracks.

Readability rules: the middle 70% of the image width, from 35% down to 100% of the height, must stay calm, uncluttered and mid-dark in value so that fighting characters in front of it stand out. No props, no objects and no bright shapes in front of the wall in the center; put detail and brightness only at the top and at the far left and right edges. Symmetrical, stable composition with strong horizontal lines.

Palette: deep blue-black shadows (#07080C to #151821), signal yellow (#FFE81A) accents, cold cyan (#35E1FF) rim light, tiny hot-red (#FF3B3B) accents.

Strictly no people, no characters, no creatures, no text, no letters, no numbers, no logos, no watermark, no frame or border, no user-interface elements.
```

**验收**
- 地面是一条水平的宽带，上边界在画面约 2/3 高度，亮边线在约 84% 高度。
- 画面中部没有高亮或杂乱物体。
- 没有透视倾斜（不要俯视、不要斜角）。

---

## A3 · `fx-grunge` — 全局印刷质感叠层

纯黑底上的灰白颗粒，会盖在菜单和房间背景上。

**Prompt**

```text
Full-frame 16:9 abstract grunge overlay texture, to be blended over a video-game user interface. Flat pure black (#000000) background. Only fine light-grey and white marks: dense film grain, scattered dust specks, hair-thin scratches, faint halftone dot clusters, torn print-edge fragments and a few thin horizontal glitch lines. The marks are denser near the four corners and edges and very sparse in the middle third of the frame. It looks like a scan of a worn, over-photocopied zine or dirty old film. No objects, no recognizable shapes, no gradients, no color (monochrome only), no text, no letters, no numbers.
```

**验收**
- 背景是纯黑，不是深灰。
- 中间很干净，角落更脏。
- 没有任何可辨认的物体。

---

## A4 · `fx-speed` — 速度线

纯黑底上的白色放射线，用在开场对阵画面。

**Prompt**

```text
Manga-style radial speed lines (focus lines) exploding outward from the exact center of a 16:9 frame. Hand-inked, tapered, razor-sharp white lines of widely varying thickness and length on a flat pure black (#000000) background. The central 20% of the frame is empty black; the lines are strongest in a ring around it and break up irregularly toward the edges, with a few long lines stretching all the way to the corners. Slightly imperfect, energetic, high contrast. Monochrome white on black only. No other elements, no shading, no gradients, no text.
```

**验收**
- 放射中心正好在画面中心。
- 中心有一块纯黑的空区。
- 只有白线和黑底。

---

## A5 · `emblem` — 标志图形（无文字）

方图，纯黑底白色图形。会缩到约 32 到 44 像素放在左上角，所以**必须极简**：粗块面，3 到 4 个元素，缩小后仍能认出新月和六边形。字样“AVE MUJICA 乱斗剧场”由代码排版，这里只要图形。

**Prompt**

```text
A bold, minimal, perfectly symmetrical emblem logo mark with no text, flat vector style, solid pure white on a flat pure black (#000000) background. Design: a thick crescent moon cradling a small diamond, enclosed in a hexagonal outline with two notched corners. Only these three elements, built from sharp straight edges and thick solid shapes, with generous empty space inside the hexagon. Must stay clearly legible when shrunk to 32 pixels, so no thin hairlines, no fine detail, no ornament. Centered, filling about 75% of a square frame, clean edges, no gradients, no shading, no text, no letters.
```

**验收**
- 缩到很小仍能看出新月和六边形轮廓。
- 只有白和黑，没有灰色渐变。
- 没有字母，没有细线。

---

## B1 · `bg-arena-b` — 战斗舞台二

与 A2 同样的版式要求，场景换成雨夜天台，让两局之间有变化。

**Prompt**

```text
2D side-scrolling fighting-game stage background, 16:9, straight-on orthographic view at eye level, with no perspective tilt, like a flat stage set seen from the audience. Anime action-game environment art: cel-shaded shapes with soft painterly gradients and crisp edges.

Layout, measured from the top of the image (very important):
- 0% to 66%: a rainy night sky and distant megacity skyline. Layered silhouettes of industrial towers, smokestacks and apartment blocks with small lit windows in yellow and cyan, a large pale crescent moon behind thin clouds, vague neon billboards drawn as abstract glowing rectangles with no lettering, a faint violet haze. At the far left and far right edges, close silhouettes of a rusted water tower and radio antennas.
- 66% to 100%: a wide, perfectly flat, perfectly horizontal rooftop floor of dark wet asphalt spanning the full width, with soft puddle reflections of the city lights. A thin bright yellow-white edge line runs along the floor at 83.6% from the top, with yellow-and-black hazard stripes just below it. A faint painted ring marking sits in the middle of the floor.

Readability rules: the middle 70% of the image width, from 35% down to 100% of the height, must stay calm, uncluttered and mid-dark in value so that fighting characters in front of it stand out. No props, no objects and no bright shapes in the center; put detail and brightness only at the top and at the far left and right edges. Stable composition with strong horizontal lines.

Palette: deep blue-black shadows (#07080C to #151821), signal yellow (#FFE81A) accents, cold cyan (#35E1FF) rim light, tiny hot-red (#FF3B3B) neon accents, a hint of violet in the haze.

Strictly no people, no characters, no creatures, no text, no letters, no numbers, no logos, no watermark, no frame or border, no user-interface elements.
```

**验收**：同 A2。

---

## B2 · `fx-burst` — 冲击爆裂

方图，纯黑底上的一个白色爆裂图形，代码染成红色放在 K.O. 字样身后。

**Prompt**

```text
One large comic-book impact burst: a jagged, irregular explosion star silhouette with sharp spikes of very different lengths, plus a few detached small shards and ink splatter dots around it. Solid pure white shape on a flat pure black (#000000) background. Flat, bold, high contrast, no outline, no gradient, no shading, no inner details. Centered, filling about 80% of a square frame. No text.
```

**验收**：只有一个主爆裂图形，白黑两色，没有渐变。

---

## B3 · `deco-shards` — 碎片装饰图集

一张图里排 8 个独立形状。脚本按位置自动切成单图，之后可以染成各角色的主题色，当角色身后的色块。

**Prompt**

```text
A graphic design sheet of 8 separate abstract shapes laid out in a neat 4 by 2 grid on a flat pure black (#000000) background. Every shape is solid pure white, flat, crisp and vector-like, with no gradients and no outlines. Leave generous empty black space between the shapes so that none of them touch or overlap each other or the image edge. The shapes: 1) a tall jagged angular shard, 2) a wide diagonal slab with chamfered corners and two notches, 3) a dry-brush ink swipe with rough edges, 4) a cluster of shattered glass fragments, 5) a rough torn-paper strip, 6) a spray-paint splatter blob with drips, 7) a thick lightning zigzag bar, 8) a halftone-dot circular burst. No text, no letters, no numbers, no labels.
```

**验收**：每个形状完整、互不相连，周围留有黑边；一共 8 个。

---

## B4 · `deco-marks` — 标记贴纸图集

同样是图集，12 个技术标记，用来做边角点缀。

**Prompt**

```text
A graphic design sheet of 12 separate technical graphic marks and print elements laid out in a neat 4 by 3 grid on a flat pure black (#000000) background. Every element is solid pure white, flat 2D and crisp, with generous empty black space between elements so that none touch or overlap each other or the image edge. The elements: 1) a barcode strip, 2) three stacked chevron arrows pointing right, 3) a crosshair registration mark inside a circle, 4) a pair of corner brackets, 5) a dotted grid of small plus signs, 6) a diagonal hazard-stripe tape segment, 7) a small dot-matrix grid block, 8) a long thin arrow with ruler tick marks, 9) a hexagon outline with a smaller hexagon inside, 10) a stack of three parallel slanted bars of different lengths, 11) a dotted circular target ring with a gap, 12) a strip of abstract pseudo-glyph symbols made from random geometric marks (not readable text). No letters, no numbers, no labels.
```

**验收**：12 个元素各自独立，没有可读的字母和数字。

---

## 反馈与迭代

- 看到接入效果后，用一句话描述问题即可，例如“菜单背景右边太亮”“舞台地面太花”“标志太复杂”“速度线太密”。我会改提示词，或调代码里的暗角、混合方式和透明度。
- 某张图不满意时只重做那一张，其他不用动。重新放进来覆盖同名文件，再告诉我即可。
- 脚本会提示常见问题：比例不是 16:9（会居中裁切）、宽度偏小、黑底不够黑、图集切出的数量和提示词不符。
- 你放好原图后，我运行一次处理脚本（裁切、转 WebP、黑底转透明、图集切图）；处理完界面**自动**读取，不需要改代码，刷新页面即可看到。
