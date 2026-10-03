"""Prepare ten short, real public voice cues. Research files stay out of releases.

Requires ffmpeg and the reviewed candidate JSON from the source audit. Never
accepts cookies, authenticated links, video downloads, or text-to-speech.
"""
import array
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "scripts" / "source-evidence"
candidate_path = ROOT / ".scratch" / "voice-source" / "prts-short-candidates.json"
candidates = json.loads(candidate_path.read_text(encoding="utf-8"))
characters = candidates["characters"]
assert {character["id"] for character in characters} == {"gale", "iron", "shadow", "pyro", "bastion"}
# The original sea-bass grunt is only .288 seconds. This verified deployment
# cue gives the same character a longer Japanese language anchor.
for character in characters:
    if character["id"] == "bastion":
        character["clips"][1] = {
            "cue": "CN_023", "label": "部署1", "translationZh": "就位。",
            "transcriptJa": None,
            "publicUrl": "https://torappu.prts.wiki/assets/audio/voice/char_4186_tmoris/cn_023.wav",
        }
asr = json.loads((RESEARCH / "voice-asr.json").read_text(encoding="utf-8"))
anchor = json.loads((RESEARCH / "bastion-anchor-asr.json").read_text(encoding="utf-8"))
language_rows = {(row["id"], row["cue"]): row for row in asr["clips"]}
language_rows[(anchor["id"], anchor["cue"])] = anchor


def prepare(item):
    character, cue = item
    identifier = character["id"]
    assert cue["publicUrl"].startswith("https://torappu.prts.wiki/assets/audio/voice/")
    source = RESEARCH / (identifier + "-" + cue["cue"].lower() + ".wav")
    if not source.exists():
        with urllib.request.urlopen(cue["publicUrl"], timeout=20) as response:
            if response.status != 200:
                raise RuntimeError("Public audio unavailable")
            source.write_bytes(response.read())
    with wave.open(str(source), "rb") as audio:
        frames, rate, channels, width = audio.getnframes(), audio.getframerate(), audio.getnchannels(), audio.getsampwidth()
        duration = frames / rate
        assert channels == 1 and width == 2 and 0 < duration < 2
        samples = array.array("h", audio.readframes(frames))
        assert max(abs(value) for value in samples) > 1000
    relative = "assets/audio/" + identifier + "/" + cue["cue"].lower() + ".wav"
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    fade = f"afade=t=in:st=0:d=0.004,afade=t=out:st={max(0, duration - .006):.9f}:d=0.006"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                    "-ss", "0", "-t", f"{duration:.9f}", "-af", fade,
                    "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(destination)], check=True)
    with wave.open(str(destination), "rb") as output:
        assert output.getnframes() > 0
        output_duration = output.getnframes() / output.getframerate()
    detection = language_rows[(identifier, cue["cue"])]
    return {
        "id": identifier, "character": character["name"], "cue": cue["cue"], "label": cue["label"],
        "file": relative, "sourcePage": character["sourcePage"], "sourceUrl": cue["publicUrl"],
        "sourceIntervalSeconds": [0, duration], "sourceIntervalFrames": [0, frames],
        "sourceSampleRate": rate, "durationSeconds": output_duration,
        "translationZh": cue["translationZh"], "verifiedSourceTranscriptJa": cue["transcriptJa"],
        "automaticLanguage": detection["language"], "automaticLanguageProbability": detection["probability"],
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "outputSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
    }


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    metadata = list(pool.map(prepare, [(character, cue) for character in characters for cue in character["clips"]]))
clips = {}
for identifier in [character["id"] for character in characters]:
    files = [item["file"] for item in metadata if item["id"] == identifier]
    assert len(files) == 2
    clips[identifier] = {"select": [files[0]], "start": [files[0]], "skill": [files[1]], "ult": [files[1]], "win": [files[0]]}
manifest = {
    "available": True,
    "status": "五名角色的日语原声短句已准备：每人两条，来自公开游戏语音记录。来源详见作品与素材。",
    "checkedOn": "2026-09-30", "clips": clips, "clipMetadata": metadata,
    "totalClips": len(metadata), "totalDurationSeconds": sum(item["durationSeconds"] for item in metadata),
    "spokenWordsPerCharacterSourceLimit": 25,
    "excerptPolicy": "每个角色仅两条极短呼声或单句，总时长不超过2.1秒；保留完整短句。每来源上限25个spoken words，不引入长对白或歌曲。",
    "languageVerification": {
        "method": "Real PCM decode + PRTS character/cue mapping + faster-whisper tiny automatic detection without forced language.",
        "candidateGroupLanguage": asr["combined"]["language"],
        "candidateGroupProbability": asr["combined"]["probability"],
        "longerBastionAnchorProbability": anchor["probability"],
        "limit": "极短呼声的单条自动语种会误判；其角色和游戏语音记录来源已核对。ASR文字不是已核实字幕。除祥子两条，页面原日语栏为空；未宣称逐条人工试听。",
    },
    "bilibiliCandidateSources": {
        "gale": "https://www.bilibili.com/video/BV1EjamzfEJr/",
        "iron": "https://www.bilibili.com/video/BV1n3amzAE98/",
        "shadow": "https://www.bilibili.com/video/BV1toa2zkEmP/",
        "pyro": "https://www.bilibili.com/video/BV1pMamzNEHZ/",
        "bastion": "https://www.bilibili.com/video/BV1ZEamztEoe/",
    },
    "bilibiliExcerptWords": 0,
    "permission": "PRTS是玩家Wiki，不是官方授权库。公开可下载不代表获得游戏音频再使用许可；本项目不宣称已获许可。",
}
(ROOT / "assets/audio/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"clips": len(metadata), "seconds": round(manifest["totalDurationSeconds"], 3), "output": "assets/audio/manifest.json"}))
