"""Transcribe the final mix: is the voice-over intelligible over the music?"""
from pathlib import Path
import json
from faster_whisper import WhisperModel
ROOT = Path(__file__).resolve().parent.parent
vo = json.loads((ROOT / "src" / "vo.json").read_text(encoding="utf-8"))
m = WhisperModel("small.en", device="cpu", compute_type="int8")
segs, _ = m.transcribe(str(ROOT / "public" / "audio" / "mix.wav"), language="en", vad_filter=False)
for s in segs:
    print(f"{s.start:6.2f}-{s.end:6.2f} {s.text.strip()}")
print("--- expected")
for l in vo["lines"]:
    print(f"{l['at'] / 60:6.2f} {l['text']}")
