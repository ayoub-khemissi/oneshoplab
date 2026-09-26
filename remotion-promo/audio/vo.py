"""Voice-over: Kokoro-82M TTS → trimmed takes → faster-whisper check + word timings.

Reads src/timeline.json (vo.lines), writes:
  audio/cache/vo/<id>.wav         48 kHz mono, trimmed
  src/vo.json                     per line: at, durationInFrames, words[{w, from, to}] (frames, line-relative)

Several takes per line (speed variants); whisper transcribes each and the take with the
best text match that still fits before the next line wins.
"""

from __future__ import annotations

import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "src" / "timeline.json").read_text(encoding="utf-8"))
FPS = TL["fps"]
OUT = ROOT / "audio" / "cache" / "vo"
OUT.mkdir(parents=True, exist_ok=True)
SR = 48000

# Spoken text can differ from the caption text (numbers, abbreviations).
SPOKEN = {
    "One forty-seven, a.m.": "One forty-seven... A.M.",
    "OneShopLab. Connect your store. The AI does the rest.": "One Shop Lab. Connect your store. The A.I. does the rest.",
    "The AI rewrites your titles, descriptions and photos.": "The A.I. rewrites your titles, descriptions, and photos.",
}


def norm(s: str) -> str:
    s = s.lower().replace("oneshoplab", "one shop lab").replace("a.i.", "ai").replace("a.m.", "am")
    return " ".join(re.sub(r"[^a-z0-9 ]+", "", s.replace("-", " ")).split())


def trim(x: np.ndarray, thresh_db: float = -45.0, pad: int = int(0.04 * SR)) -> np.ndarray:
    env = np.convolve(np.abs(x), np.ones(480) / 480, mode="same")
    idx = np.where(env > 10 ** (thresh_db / 20))[0]
    if len(idx) == 0:
        return x
    a, b = max(0, idx[0] - pad), min(len(x), idx[-1] + pad * 3)
    y = x[a:b].copy()
    fade = int(0.01 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def main() -> None:
    from kokoro import KPipeline
    from faster_whisper import WhisperModel

    voice = TL["vo"]["voice"]
    base_speed = TL["vo"]["speed"]
    only = set(sys.argv[1:])

    pipe = KPipeline(lang_code="a")
    whisper = WhisperModel("small.en", device="cpu", compute_type="int8")

    lines = TL["vo"]["lines"]
    prev = {}
    vo_json_path = ROOT / "src" / "vo.json"
    if vo_json_path.exists():
        prev = {l["id"]: l for l in json.loads(vo_json_path.read_text(encoding="utf-8"))["lines"]}

    result = []
    for i, line in enumerate(lines):
        if only and line["id"] not in only and line["id"] in prev:
            result.append({**prev[line["id"]], "at": line["at"], "text": line["text"]})
            continue
        slot = (lines[i + 1]["at"] if i + 1 < len(lines) else TL["durationInFrames"]) - line["at"]
        spoken = SPOKEN.get(line["text"], line["text"])
        takes = []
        for speed in (base_speed, base_speed - 0.05, base_speed + 0.06):
            chunks = [np.asarray(a, dtype=np.float32) for _, _, a in pipe(spoken, voice=voice, speed=speed)]
            x = np.concatenate(chunks)
            x = resample_poly(x, 2, 1).astype(np.float32)  # 24k → 48k
            x = trim(x)
            segs, _ = whisper.transcribe(x[::3].astype(np.float32), language="en", word_timestamps=True, beam_size=5)
            words = [w for s in segs for w in (s.words or [])]
            heard = " ".join(w.word.strip() for w in words)
            score = SequenceMatcher(None, norm(heard), norm(line["text"])).ratio()
            dur = len(x) / SR
            fits = dur * FPS <= slot - 6
            takes.append((fits, score, -abs(speed - base_speed), speed, x, words, heard))
            print(f"  {line['id']} speed={speed:.2f} dur={dur:.2f}s slot={slot / FPS:.2f}s match={score:.2f} heard={heard!r}")
        takes.sort(key=lambda t: (t[0], round(t[1], 2), t[2]), reverse=True)
        fits, score, _, speed, x, words, heard = takes[0]
        if not fits:
            print(f"!! {line['id']} overflows its slot ({len(x) / SR:.2f}s > {slot / FPS:.2f}s)")
        if score < 0.85:
            print(f"!! {line['id']} low match {score:.2f}: {heard!r}")
        sf.write(OUT / f"{line['id']}.wav", x, SR, subtype="FLOAT")

        # Caption words come from the caption text; timings from whisper, matched by order.
        cap_words = line["text"].split()
        timed = [(w.start, w.end) for w in words]
        if len(timed) != len(cap_words):
            # Fall back to spreading the caption words over the heard span proportionally to length.
            t0 = timed[0][0] if timed else 0.0
            t1 = timed[-1][1] if timed else len(x) / SR
            lens = np.array([len(w) + 2 for w in cap_words], dtype=float)
            edges = t0 + (t1 - t0) * np.concatenate([[0], np.cumsum(lens) / lens.sum()])
            timed = list(zip(edges[:-1], edges[1:]))
        result.append(
            {
                "id": line["id"],
                "text": line["text"],
                "at": line["at"],
                "speed": speed,
                "durationInFrames": int(np.ceil(len(x) / SR * FPS)),
                "words": [
                    {"w": w, "from": int(round(a * FPS)), "to": int(round(b * FPS))}
                    for w, (a, b) in zip(cap_words, timed)
                ],
            }
        )
        print(f"-> {line['id']} speed {speed:.2f}, {len(x) / SR:.2f}s, match {score:.2f}")

    vo_json_path.write_text(json.dumps({"voice": voice, "lines": result}, indent=2), encoding="utf-8")
    print("wrote", vo_json_path)


if __name__ == "__main__":
    main()
