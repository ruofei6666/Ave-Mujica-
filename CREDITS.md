# 作品与素材记录

这是娱乐用途的 Ave Mujica / BanG Dream! 同人小游戏。角色名称、原形象与相关世界观归相应原权利方。

## 角色图片（2026-10-02）

旧的五张角色贴纸与程序人物绘制已移除。当前全身立绘、头像、大招半身像与动作图集使用内置 `image_gen` 生成的透明图片，位于 `assets/characters/`。图片是参考官方舞台形象的 AI 同人再创作，不是官方素材，也不宣称获得官方授权。

官方形象参考：[丰川祥子](https://anime.bang-dream.com/avemujica/character/sakiko/)、[三角初华](https://anime.bang-dream.com/avemujica/character/uika/)、[若叶睦](https://anime.bang-dream.com/avemujica/character/mutsumi/)、[八幡海铃](https://anime.bang-dream.com/avemujica/character/umiri/)、[祐天寺若麦](https://anime.bang-dream.com/avemujica/character/nyamu/)。官方参考原图仅用于本机生成对照，不进入运行资源或发布包。

每位角色有 24 张独立动作图片：4 帧待机、6 帧步行、2 帧跳跃、4 帧普攻、4 帧技能、2 帧受击、2 帧胜利。普攻按起手、蓄势、出手、收招切换图片，技能帧跟随真实出招时间点；角色全程持有各自的乐器。祥子使用键盘，初华与睦使用吉他，海铃使用贝斯，喵梦使用鼓棒。

静止时固定使用第一张待机图片，取消待机循环和呼吸缩放。步行保留六个实际姿势，在相邻帧末段加入短过渡；步频跟随移动距离，联机位置使用匀速插值，地面松开方向键即停止移动。其余三张待机原图保留在图集中作为素材，不在静止时循环。

五位角色的全身立绘、头像、大招半身像和动作图集统一重新制作。人物脸型、眼睛、发型与舞台服装按上述动画官网形象参考；修正初华的紫色眼睛与裤装、祥子的低双马尾、海铃的及膝短裤等细节。头像和半身像从同一张新版立绘取景，保持各界面人物一致。

| 角色 | 本次乐器还原依据 |
|---|---|
| 初华 | [SCHECTER AC-AR-07-AveMujica/Doloris/SIG](https://schecter.co.jp/collaboration/4432/?products=ac-ar-07-avemujica%2Fdoloris%2Fsig)：黑色偏移琴身、金色硬件、枫木指板，七弦、七个单侧弦钮 |
| 睦 | [SCHECTER AC-EX-7-AveMujica/Mortis/SIG](https://schecter.co.jp/collaboration/4432/?products=ac-ex-7-avemujica%2Fmortis%2Fsig)：粉色闪光琴身、白色珍珠护板、黑色拾音器和琴桥，七弦、七个单侧弦钮 |
| 海铃 | [SCHECTER AC-EXB-5-AveMujica/Timoris/SIG](https://schecter.co.jp/collaboration/4432/?products=ac-exb-5-avemujica%2Ftimoris%2Fsig)：淡紫琴身、黑色护板、五弦与五弦鞍、4+1 银色弦钮 |
| 喵梦 | [LERNI H-140AM 产品图](https://store.shimamura.co.jp/ec/pro/disp/1/tp031-0752199)：木色细鼓棒、椭圆木尖，一手一支；产品广告只用于乐器，服装采用动画官网原版 |
| 祥子 | [Roland FA-08 厂商资料](https://www.roland.com/global/products/fa-08/)：黑色工作站外壳、琴键、控制面板和 4×4 采样垫；型号线索来自 [角色资料页](https://bandori.miraheze.org/wiki/Togawa_Sakiko)。为持琴格斗等比缩小并增加背带，这一携带方式是游戏改编 |

提示词、参考来源、生成输出与实际帧顺序在 `scripts/character-restoration-spec.json`、`scripts/character-restoration-animation-spec.json`；打包与头像取景记录在 `scripts/prepare-restored-portraits.cjs`。较早仅修正黑色贝斯弦数的中间方案记录在 `scripts/character-bass-correction-spec.json`，已被全员还原方案替代，不进入发布包。

选人立绘单独以原生高清透明图片生成，打包只裁去空白，保留至少约 1500 像素的人物高度。头像和大招半身像保留独立文件。人物外轮廓不再叠加彩色描边，也移除了立绘、头像、VS 与大招人物图片的外发光滤镜；人物本身的细节线条保留。

`scripts/character-animation-spec.json` 保存 15 组动作图的提示词、参考图、生成输出与实际帧顺序。`scripts/character-portrait-spec.json` 保存独立高清立绘的记录。`scripts/prepare-character-assets.cjs --animations` 根据透明连通像素分离每个人物、对齐脚底并打包图集；`--portraits-only` 可单独打包立绘。Canvas 仅选取和摆放完成的图片，不绘制人物身体或乐器。原先七姿势生成记录保留在 `scripts/character-art-spec.json`。

舞台与战斗特效由 `src/game/fx.ts`、`stage.ts`、`renderer.ts` 绘制，界面由 `src/components/` 和 `src/styles/` 渲染。浏览器只加载本地素材，不读取第三方图片 CDN。

## 配乐、音效与语音（2026-10-02）

背景配乐、战斗音效与按钮点击音由 `src/game/audio.ts` 和 `src/game/sfx.ts` 原创 WebAudio 合成（只用振荡器与滤波噪声，没有采样），不采用歌曲片段，也未使用任何游戏的音效文件。三项默认音量均为 100%；本次更新将已有设置迁移到满音量一次，之后的手动调整正常保留。打击与点击音效增加 3.6 倍内部增益，音效滑块仍可完全静音。语音播放时配乐降至原音量的 25%，打击音效降至 65%，结束后恢复。三条音量总线可独立调整，输出设有峰值限制。

角色只使用三类台词：选人、大招、K.O.。K.O. 播放获胜角色的台词，两边客户端都遵循同一胜者；平局和时间到不触发 K.O. 台词。普通攻击、普通技能、受击不再触发角色台词。

实际角色原声来自 **PRTS 玩家 Wiki 正常公开的角色语音下载链接**，为《明日方舟》Ave Mujica 联动角色的原始配音。五名角色各有 3 个不同的本地 WAV，共 15 个。来源下载链接已于 2026-10-02 重新核对。

| 角色与记录页 | 选人 | 大招 | 获胜 K.O. |
|---|---|---|---|
| [丰川祥子](https://prts.wiki/w/丰川祥子/语音记录) | CN_021 选中干员 1 | CN_028 作战中 4 | CN_030 三星结束行动 |
| [三角初华](https://prts.wiki/w/三角初华/语音记录) | CN_021 | CN_028 | CN_030 |
| [若叶睦](https://prts.wiki/w/若叶睦/语音记录) | CN_021 | CN_028 | CN_029 完成高难行动 |
| [八幡海铃](https://prts.wiki/w/八幡海铃/语音记录) | CN_021 | CN_028 | CN_029 |
| [祐天寺若麦](https://prts.wiki/w/祐天寺若麦/语音记录) | CN_021 | CN_028 | CN_030 |

祥子的大招保留原音频 2.900000–4.581361 秒的单个短子句。其余所选 cue 保留原短句。中文译文只在原页面可核对时记录；祥子有可核对的日文原文，其余四人页面的日文栏为空，对应记录保持空值，不把机器识别结果当作字幕。

开场的 **Round 1 / Fight** 已换为 [VoiceBosch 的 MR. HAPPY - Announcer Audio Pack](https://voicebosch.itch.io/mr-happy-announcer-audio-pack) 中由 VoiceBosch 录制、制作的男性格斗播报。来源分别为 `09. Round 1.wav` 与 `24. Fight.wav`，保留原录音 0.295–1.585 秒、0.525–1.185 秒，去掉多余的开头静音和长尾，得到约 1.29 秒与 0.66 秒的两句。制作时做轻微清晰度均衡、压缩、响度统一和短淡入淡出，不额外添加回声，不合成或克隆声音。两句均为新配音者的独立录音，旧 Kenney 版本已存档。

原素材与本项目修改后的两个播报 WAV 按 **CC BY-SA 4.0 International** 分发。署名为 VoiceBosch，来源、许可链接与修改说明随文件保留在 `assets/audio/system/VoiceBosch-License.txt`；角色原声仍使用下述各自来源。

按钮只使用 18–90 毫秒的合成点击/确认反馈，走音效总线，不播报按钮名称，也不会打断选人、大招或获胜台词。旧系统朗读 WAV 已存档到 `.scratch/audio-previous/system/`，不再进入运行资源或发布包。

当前运行清单共有 **17 个 WAV**：15 个角色台词、2 个开场播报。音频统一为 44.1 kHz、单声道、16 bit PCM，并进行响度归一与短淡入淡出。原下载页、时间区间、输入/输出 SHA256、时长、峰值与 RMS，以及播报来源、原文件名和许可，都在 `assets/audio/manifest.json` 中。`scripts/audio-voice-spec.json` 是构建输入，`scripts/prepare-game-audio.py` 可重新制作运行文件；加 `--announcer-only` 可保留已有角色台词，只重新制作开场播报。VoiceBosch 的原文件在官方页面点击免费 Download 后分别下载为规范中 `sourceFile` 指定的路径，构建前会核对原文件 SHA256；原文件已缓存在本机忽略的 `.scratch/audio-refresh/voicebosch/`。原始下载、旧语音与研究资料不进入发布包。

浏览器检查验证文件 HTTP 加载、非零音频解码、实际播放节点、开场时机、角色事件与音量控制。工具未提供人工听觉输入，不把这些自动检查声称为逐条人工试听。

PRTS 是玩家 Wiki，公开下载不代表取得游戏音频的再使用许可。本项目未获得上传者或游戏权利方授权。角色原声取得或播放失败不会阻止对战。

## 历史候选来源

此前用户提供的 B 站候选为：若叶睦 BV1EjamzfEJr、祐天寺若麦 BV1n3amzAE98、三角初华 BV1toa2zkEmP、丰川祥子 BV1pMamzNEHZ、八幡海铃 BV1ZEamztEoe。普通下载请求遭遇 HTTP 412 或公开接口访问错误，没有成功提取 B 站音轨，也没有绕过登录、验证码或读取用户 cookies。当前素材来源记作 PRTS；历史 32 文件/四技能语音方案已被上述三类台词方案替换。

## UI 美术

2026-10-03 起的“暗色广播控制台”界面以《明日方舟：终末地》的工业科幻界面语言与《绝区零》的街头直播视觉为风格参考，只借鉴整体气质，没有使用这两款游戏的 Logo、界面截图、角色或任何素材。切角面板、按钮、血条、图标和全部文字由 Vue、CSS 与 SVG 在代码中绘制。

生成背景与纹理（`bg-menu`、`bg-arena-a/b`、`fx-grunge`、`fx-speed`、`fx-burst`、`emblem`、`deco-shards`、`deco-marks`）已于 2026-10-03 交付：由内置图像生成工具（`image_gen`）按 `art-inbox/PROMPTS.md` 的提示词生成，共 36 张候选，择优 9 张原图；两张舞台图只做了轻微裁切，使地面亮线落在 83.6% 高度（实测 83.70% 和 83.61%）。经 `scripts/prepare-ui-art.py` 处理成 27 个 WebP（背景 1920×1080，遮罩为白色加透明度，两张图集切出 8 张 `deco-shards` 和 12 张 `deco-marks`），放在 `assets/ui/art/`，清单为 `assets/ui/art/manifest.json`。工具实际返回的是 1672×941 的背景、1254×1254 的方图和 1536×1024 的图集，背景是插值放大到 1920×1080，并非原生 1080p。选择理由、各张提示词和裁切框记在本机的 `art-inbox/generation-record-20261003.json` 与 `art-inbox/crop-alignment-20261003.json`，候选原图在 `art-inbox/candidates-20261003/`，这些记录不随仓库提交。清单缺失或为空时，界面自动使用代码绘制的备用效果。

字体：[Barlow Condensed](https://github.com/jpt/barlow)（Jeremy Tribby）与 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)（JetBrains），均按 SIL Open Font License 1.1 分发，通过 `@fontsource` 包随构建产物提供，不读取字体 CDN。中文使用系统字体。

## 依赖

服务器使用 `ws` 8.22.0，按其 MIT 许可分发，许可证随 `node_modules/ws/LICENSE` 进入发布包。浏览器运行时不读取第三方 CDN 的库、字体、图片或声音。
