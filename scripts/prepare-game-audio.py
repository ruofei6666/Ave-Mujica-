"""Package three authentic character cues and a recorded arcade announcer.

Sources stay in .scratch; only normalized, playable WAVs and provenance ship.
No character speech is synthesized or cloned.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import urllib.request
import wave
from array import array

ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def pcm_info(file):
    with wave.open(str(file), 'rb') as wav:
        samples = array('h', wav.readframes(wav.getnframes()))
        return dict(durationSeconds=wav.getnframes() / wav.getframerate(),
                    sampleRate=wav.getframerate(), channels=wav.getnchannels(),
                    peakPcm16=max(map(abs, samples), default=0),
                    rmsPcm16=round(math.sqrt(sum(x*x for x in samples) / max(1, len(samples))), 2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
    parser.add_argument('--announcer-only', action='store_true', help='Preserve the 15 existing character clips')
    args = parser.parse_args()
    if not args.ffmpeg:
        raise SystemExit('ffmpeg is required')
    spec = json.loads((ROOT / 'scripts/audio-voice-spec.json').read_text(encoding='utf-8'))
    scratch = ROOT / '.scratch/audio-refresh'
    scratch.mkdir(parents=True, exist_ok=True)
    narrator = scratch / 'voicebosch-announcer'
    narrator.mkdir(exist_ok=True)
    source = spec['announcerSource']
    for entry in spec['system']:
        raw = ROOT / entry['sourceFile']
        if not raw.is_file():
            raise RuntimeError(f'Missing recorded source: {raw}. {source["downloadInstructions"]}')
        if digest(raw) != entry['sourceSha256']:
            raise RuntimeError(f'Announcer source checksum mismatch: {raw}')
        start, end = entry['sourceIntervalSeconds']
        subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw),
                        '-af', f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS',
                        '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', str(narrator / (entry['cue'] + '.wav'))], check=True)
    old = json.loads((ROOT / 'assets/audio/manifest.json').read_text(encoding='utf-8'))
    manifest = dict(version=spec['audioVersion'], available=True, checkedOn='2026-10-02',
                    status='选人、大招与获胜角色 K.O. 台词已加载；开场使用格斗播报，按钮使用点击音效。',
                    defaultVolumes=dict(music=1, sfx=1, voice=1),
                    sfxGain=3.6,
                    clips={}, clipMetadata=[], systemClips={}, systemMetadata=[])

    def normalize(source, output, is_announcer=False):
        output.parent.mkdir(parents=True, exist_ok=True)
        duration = pcm_info(source)['durationSeconds']
        filters = ['highpass=f=70', 'loudnorm=I=-18:TP=-2:LRA=7']
        if is_announcer:
            filters = ['highpass=f=65', 'equalizer=f=2800:t=q:w=1:g=1.5',
                       'acompressor=threshold=0.16:ratio=2:attack=3:release=55',
                       'loudnorm=I=-16:TP=-2:LRA=5']
        filters += ['afade=t=in:d=0.006', f'afade=t=out:st={max(0, duration-.012):.6f}:d=0.012']
        subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-af', ','.join(filters), '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', str(output)], check=True)
        info = pcm_info(output)
        if info['peakPcm16'] == 0 or info['peakPcm16'] > 28000:
            raise RuntimeError(f'Invalid normalized audio: {output}: {info}')
        return info

    if args.announcer_only:
        manifest['clips'] = old['clips']
        manifest['clipMetadata'] = old['clipMetadata']
    for character in ([] if args.announcer_only else spec['characters']):
        ident = character['id']
        manifest['clips'][ident] = {}
        for cue, entry in character['cues'].items():
            target = f'assets/audio/{ident}/{cue}.wav'
            cached = scratch / f'{ident}-{entry["sourceCue"].lower()}.wav'
            if not cached.exists():
                if entry.get('existingFile') and (ROOT / entry['existingFile']).exists():
                    shutil.copyfile(ROOT / entry['existingFile'], cached)
                else:
                    request = urllib.request.Request(entry['sourceUrl'], headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(request, timeout=40) as response:
                        cached.write_bytes(response.read())
                    if entry.get('cropped'):
                        full = scratch / f'{ident}-{entry["sourceCue"].lower()}-full.wav'
                        shutil.copyfile(cached, full)
                        start, end = entry['sourceIntervalSeconds']
                        subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(full),
                                        '-af', f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS',
                                        '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', str(cached)], check=True)
            source_info = pcm_info(cached)
            details = normalize(cached, ROOT / target)
            manifest['clips'][ident][cue] = [target]
            original = next((m for m in old.get('clipMetadata', []) if m['id'] == ident and (m.get('sourceCue') or m.get('cue')) == entry['sourceCue']), {})
            manifest['clipMetadata'].append(dict(id=ident, character=character['name'], cue=cue,
                sourceCue=entry['sourceCue'], label=entry['label'], file=target,
                sourcePage=character['sourcePage'], sourceUrl=entry['sourceUrl'],
                translationZh=entry.get('translationZh'), verifiedSourceTranscriptJa=entry.get('transcriptJa'),
                sourceIntervalSeconds=entry.get('sourceIntervalSeconds', original.get('sourceIntervalSeconds', [0, source_info['durationSeconds']])),
                cropped=entry.get('cropped', original.get('cropped', False)), sourceSha256=entry.get('sourceSha256', original.get('sourceSha256', digest(cached))),
                inputSha256=digest(cached), outputSha256=digest(ROOT / target), **details))
    for entry in spec['system']:
        cue = entry['cue']
        target = entry['outputFile']
        details = normalize(narrator / f'{cue}.wav', ROOT / target, True)
        manifest['systemClips'][cue] = [target]
        manifest['systemMetadata'].append(dict(**entry, file=target, source=source,
            inputSha256=digest(ROOT / entry['sourceFile']), outputSha256=digest(ROOT / target),
            processing='Trim leading silence and long tails; mono, presence EQ, light compression, -16 LUFS / -2 dBTP, short fades; no added echo', **details))
    (ROOT / 'assets/audio/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (scratch / 'validation.json').write_text(json.dumps(dict(characterClips=len(manifest['clipMetadata']),
        systemClips=len(manifest['systemMetadata']), metadata=manifest), ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Packed {len(manifest["clipMetadata"])} character clips and {len(manifest["systemMetadata"])} narrator clips')


if __name__ == '__main__':
    main()
