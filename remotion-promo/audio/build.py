"""Score + sound design + mix, all synthesised (no samples).

Reads src/timeline.json (tempo, scenes, cues) and src/vo.json + audio/cache/vo/*.wav,
writes public/audio/mix.wav (48 kHz stereo, -14 LUFS, -1 dBTP) and out/audio-check.png.

Harmony (D major): night Bm7 | Gmaj7 | Dadd9 | Asus-A, grind turns to Em | F#7,
tape-stop at the freeze, the drop lands on D | A | Bm | G, the morning is G | A
and the end card resolves on Dmaj9.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
TL = json.loads((ROOT / "src" / "timeline.json").read_text(encoding="utf-8"))
VO = json.loads((ROOT / "src" / "vo.json").read_text(encoding="utf-8"))
SR = 48000
FPS = TL["fps"]
BEAT = 60 / TL["bpm"]
BAR = BEAT * 4
DUR = TL["durationInFrames"] / FPS
N = int(DUR * SR) + SR  # 1 s tail, trimmed at the end
CUE = TL["cues"]
SC = TL["scenes"]
rng = np.random.default_rng(7)


def fr(f: float) -> float:
    return f / FPS


def hz(note: str) -> float:
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    n, o = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[n] + 12 * (o + 1) - 69) / 12)


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100), "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, min(hi, SR / 2 - 100)], "band", fs=SR, output="sos"), x)


class Bus:
    """Stereo accumulation buffer."""

    def __init__(self):
        self.x = np.zeros((N, 2), dtype=np.float64)

    def add(self, sig: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0):
        i = int(at * SR)
        if i >= N or i + len(sig) <= 0:
            return
        if sig.ndim == 1:
            l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
            sig = np.stack([sig * l * 1.414, sig * r * 1.414], axis=1)
        if i < 0:
            sig, i = sig[-i:], 0
        n = min(len(sig), N - i)
        self.x[i : i + n] += sig[:n] * gain


# ------------------------------------------------------------------ instruments


def piano(f0: float, dur: float = 2.5, vel: float = 0.7) -> np.ndarray:
    """Felt piano: inharmonic additive partials, per-partial decay, soft hammer."""
    t = t_axis(dur)
    B = 0.0004
    out = np.zeros_like(t)
    for k in range(1, 11):
        fk = f0 * k * np.sqrt(1 + B * k * k)
        if fk > 12000:
            break
        amp = (1 / k**1.3) * (0.6 + 0.4 * vel) ** (k * 0.4)
        dec = 1.2 + k * 0.9 + f0 / 600
        out += amp * np.exp(-t * dec) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28))
    atk = np.minimum(1, t / 0.004)
    hammer = lp(rng.standard_normal(len(t)) * np.exp(-t * 90), 2500) * 0.15
    y = (out * atk + hammer) * vel
    return lp(y, 3500 + 4000 * vel)


def pad(freqs: list[float], dur: float, bright: float = 1400, attack: float = 0.8) -> np.ndarray:
    t = t_axis(dur)
    out = np.zeros((len(t), 2))
    for f0 in freqs:
        for ch, det in ((0, -0.08), (1, 0.08), (0, 0.03), (1, -0.03)):
            f = f0 * 2 ** (det / 12)
            ph = rng.uniform(0, 1)
            saw = 2 * ((f * t + ph) % 1) - 1
            out[:, ch] += saw
    env = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / 0.6).clip(0, 1)
    out[:, 0] = lp(out[:, 0], bright, 4)
    out[:, 1] = lp(out[:, 1], bright, 4)
    return out * env[:, None] / (len(freqs) * 2.5)


def pluck(f0: float, dur: float = 0.5, bright: float = 1.0) -> np.ndarray:
    t = t_axis(dur)
    out = np.zeros_like(t)
    for k in range(1, 16):
        if f0 * k > 14000:
            break
        det = 1 + rng.uniform(-0.002, 0.002)
        out += (1 / k) * np.exp(-t * (4 + k * 2.2 / bright)) * np.sin(2 * np.pi * f0 * k * det * t)
    return out * np.minimum(1, t / 0.002)


def bell(f0: float, dur: float = 1.6, idx: float = 2.5, ratio: float = 3.5) -> np.ndarray:
    t = t_axis(dur)
    mod = idx * np.exp(-t * 5) * np.sin(2 * np.pi * f0 * ratio * t)
    return np.sin(2 * np.pi * f0 * t + mod) * np.exp(-t * 3.2) * np.minimum(1, t / 0.002)


def kick(punch: float = 1.0) -> np.ndarray:
    t = t_axis(0.5)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 7)
    click = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 400) * 0.25
    return np.tanh((body + click) * 1.6 * punch) * 0.9


def clap() -> np.ndarray:
    t = t_axis(0.35)
    n = bp(rng.standard_normal(len(t)), 900, 5000)
    env = sum(np.exp(-np.maximum(0, t - d) * 140) * (t >= d) for d in (0, 0.011, 0.023)) + 0.5 * np.exp(-np.maximum(0, t - 0.03) * 16) * (t >= 0.03)
    return n * env * 0.5


def hat(open_: bool = False) -> np.ndarray:
    t = t_axis(0.25 if open_ else 0.06)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * (18 if open_ else 90)) * 0.3


def sub(f0: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    y = np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(4 * np.pi * f0 * t)
    env = np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.05).clip(0, 1)
    return np.tanh(y * env * 1.3) * 0.6


def noise_sweep(dur: float, f_lo: float, f_hi: float, shape: str = "rise", q: float = 0.6) -> np.ndarray:
    """Band-passed noise whose centre glides f_lo→f_hi (overlap-add of filtered grains)."""
    n = int(dur * SR)
    src = rng.standard_normal(n + 4096)
    out = np.zeros(n + 4096)
    hop, win = 1024, np.hanning(2048)
    for i in range(0, n, hop):
        p = i / max(1, n)
        fc = f_lo * (f_hi / f_lo) ** p
        seg = bp(src[i : i + 2048] * win, max(40, fc * (1 - q / 2)), fc * (1 + q / 2))
        out[i : i + len(seg)] += seg
    out = out[:n]
    t = np.linspace(0, 1, n)
    if shape == "rise":
        env = t**2.2
    elif shape == "whoosh":
        env = np.sin(np.pi * t) ** 1.5
    else:
        env = (1 - t) ** 2
    return out * env / (np.abs(out).max() + 1e-9)


def ping(f0: float, dur: float = 1.2) -> np.ndarray:
    """Glassy notification: inharmonic partials."""
    t = t_axis(dur)
    y = sum(a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 4), (2.76, 0.35, 7), (5.4, 0.12, 12)))
    return y * np.minimum(1, t / 0.003)


def blip(f0: float, dur: float = 0.09, glide: float = 1.0) -> np.ndarray:
    t = t_axis(dur)
    f = f0 * glide ** (t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40) * np.minimum(1, t / 0.001)


def tick(bright: float = 1.0) -> np.ndarray:
    t = t_axis(0.03)
    return bp(rng.standard_normal(len(t)), 1500 * bright, 7000 * bright) * np.exp(-t * 300)


def key_click() -> np.ndarray:
    t = t_axis(0.05)
    body = bp(rng.standard_normal(len(t)), 1200, 6000) * np.exp(-t * 180)
    thock = np.sin(2 * np.pi * rng.uniform(180, 240) * t) * np.exp(-t * 90) * 0.5
    return (body + thock) * rng.uniform(0.6, 1.0)


def reverb_ir(dur: float = 2.4, damp: float = 5000) -> np.ndarray:
    t = t_axis(dur)
    ir = np.stack([lp(rng.standard_normal(len(t)), damp), lp(rng.standard_normal(len(t)), damp)], 1)
    ir *= np.exp(-t * 6.9 / dur)[:, None]
    ir[: int(0.012 * SR)] = 0  # predelay
    return ir / np.sqrt((ir**2).sum())


def reverb(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    return np.stack([fftconvolve(x[:, 0], ir[:, 0])[: len(x)], fftconvolve(x[:, 1], ir[:, 1])[: len(x)]], 1)


# ------------------------------------------------------------------ score

CHORDS = {
    "Bm7": ["B2", ["B3", "D4", "F#4", "A4"]],
    "Gmaj7": ["G2", ["G3", "B3", "D4", "F#4"]],
    "Dadd9": ["D3", ["D4", "F#4", "A4", "E5"]],
    "Asus": ["A2", ["A3", "D4", "E4", "A4"]],
    "A": ["A2", ["A3", "C#4", "E4", "A4"]],
    "Em7": ["E2", ["E3", "G3", "B3", "D4"]],
    "F#7": ["F#2", ["F#3", "A#3", "C#4", "E4"]],
    "D": ["D2", ["D4", "F#4", "A4", "D5"]],
    "Bm": ["B1", ["B3", "D4", "F#4", "B4"]],
    "G": ["G2", ["G3", "B3", "D4", "G4"]],
    "Dmaj9": ["D2", ["D4", "F#4", "A4", "C#5", "E5"]],
}

NIGHT = ["Bm7", "Gmaj7", "Dadd9", "Asus"]
GRIND = ["Bm7", "Em7", "F#7"]
DROP = ["D", "A", "Bm", "G", "D", "A", "Bm", "G", "D", "A"]
MORNING = ["G", "A"]


def humanize(t: float, amt: float = 0.008) -> float:
    return t + rng.uniform(-amt, amt)


def build_music() -> tuple[np.ndarray, np.ndarray]:
    """Returns (music, drums) stereo buses; the drums pump the music."""
    mus, drm = Bus(), Bus()
    freeze = fr(CUE["freeze"])
    drop = fr(SC["connect"]["from"])
    morning = fr(SC["morning"]["from"])
    cta = fr(SC["cta"]["from"])

    # --- night + grind: felt piano arpeggios over a dark pad
    arp_idx = [0, 1, 2, 3, 2, 1, 2, 3]
    for b, name in enumerate(NIGHT + GRIND):
        t0 = b * BAR
        if t0 >= freeze:
            break
        root, notes = CHORDS[name]
        grind = b >= 3
        dur = min(BAR, freeze - t0)
        mus.add(pad([hz(n) for n in notes[:3]], dur + 0.4, bright=900 + 300 * grind, attack=0.6), t0, 0.35)
        mus.add(sub(hz(root) , dur) * np.minimum(1, t_axis(dur) / 0.3), t0, 0.22 + 0.1 * grind)
        steps = 16 if grind else 8
        for s in range(steps):
            ts = t0 + s * BAR / steps
            if ts >= freeze:
                break
            n = notes[arp_idx[s % 8]]
            octave = 2 if (not grind and s % 8 == 4) else 1
            mus.add(piano(hz(n) * octave, 2.2, vel=0.45 + 0.2 * (s % 4 == 0) + rng.uniform(-0.05, 0.05)), humanize(ts), 0.22, pan=rng.uniform(-0.3, 0.3))
        # melody: one sung note per bar, the "worry" motif
        top = {"Bm7": "F#5", "Gmaj7": "D5", "Dadd9": "E5", "Asus": "C#5", "Em7": "G5", "F#7": "A#4"}[name]
        mus.add(piano(hz(top), 3.0, vel=0.62), humanize(t0 + BEAT * 0.02), 0.3, pan=0.1)

    # grind: clock ticks, getting louder
    t = 3 * BAR
    while t < freeze:
        drm.add(tick(1.2 if int(round(t / BEAT)) % 2 else 0.8), t, 0.12 + 0.2 * (t - 3 * BAR) / (freeze - 3 * BAR))
        t += BEAT
    # heartbeat pulse creeping in
    for i, t in enumerate(np.arange(4 * BAR, freeze, BEAT)):
        drm.add(kick(0.5) * 0.5, t, 0.25 + 0.2 * i / 8)

    # --- after the pause: a single note under the dot, then the riser
    dot = fr(CUE["dotCollapse"])
    mus.add(piano(hz("F#5"), 4.0, vel=0.5), dot + 0.05, 0.35)
    mus.add(piano(hz("B4"), 4.0, vel=0.4), dot + BEAT * 2, 0.25)
    mus.add(pad([hz("D4"), hz("A4"), hz("E5")], drop - dot + 0.2, bright=2500, attack=2.5), dot, 0.28)

    # --- the drop: D | A | Bm | G, future-pop pluck stabs, 4-on-the-floor
    stab_steps = [0, 3, 6, 8, 11, 14]
    for b, name in enumerate(DROP):
        t0 = drop + b * BAR
        if t0 >= morning:
            break
        root, notes = CHORDS[name]
        mus.add(pad([hz(n) for n in notes[:3]], BAR + 0.3, bright=1800, attack=0.15), t0, 0.16)
        for s in stab_steps:
            for n in notes:
                mus.add(pluck(hz(n), 0.45, bright=1.3), t0 + s * BAR / 16, 0.07, pan=rng.uniform(-0.4, 0.4))
        # bass: root on 8ths with octave jumps
        for s in range(8):
            f = hz(root) * (2 if s in (3, 7) else 1)
            mus.add(sub(f, BAR / 8 * 0.9), t0 + s * BAR / 8, 0.3)
        # bells from the generation onwards
        if t0 >= fr(SC["generate"]["from"]) - BAR:
            pattern = [0, 1, 2, 3, 2, 1, 3, 2] * 2
            for s in range(16):
                n = notes[pattern[s] % len(notes)]
                mus.add(bell(hz(n) * 2, 0.8, idx=1.6), t0 + s * BAR / 16, 0.05, pan=0.5 if s % 2 else -0.5)
        # drums
        for s in range(16):
            ts = t0 + s * BAR / 16
            if s % 4 == 0:
                drm.add(kick(), ts, 0.8)
            if s in (4, 12):
                drm.add(clap(), ts, 0.55, pan=0.05)
            drm.add(hat(open_=(s % 4 == 2)), ts, 0.2 if s % 2 else 0.1, pan=0.35)
    # fill + riser into the morning
    for i in range(8):
        drm.add(clap(), morning - BAR / 2 + i * BAR / 16, 0.18 + 0.05 * i)

    # --- morning: breakdown, G | A, warm pad + piano (the night motif, in major)
    for b, name in enumerate(MORNING):
        t0 = morning + b * BAR
        root, notes = CHORDS[name]
        mus.add(pad([hz(n) for n in notes[:4]], BAR + 0.4, bright=2200, attack=0.3), t0, 0.28)
        mus.add(sub(hz(root), BAR), t0, 0.25)
        for s in range(8):
            mus.add(piano(hz(notes[arp_idx[s] % len(notes)]) * 2, 2.0, vel=0.5), humanize(t0 + s * BAR / 8), 0.18, pan=rng.uniform(-0.3, 0.3))
        drm.add(kick(0.7), t0, 0.5)
        drm.add(kick(0.7), t0 + BAR / 2, 0.4)
    melody = [("F#5", 0), ("E5", 1.5), ("D5", 2), ("E5", 4), ("F#5", 5.5), ("A5", 6)]
    for n, beat in melody:
        mus.add(piano(hz(n), 2.5, vel=0.65), humanize(morning + beat * BEAT), 0.3)

    # --- end card: resolve on Dmaj9, let it ring
    root, notes = CHORDS["Dmaj9"]
    ring = DUR - cta + 0.8
    mus.add(pad([hz(n) for n in notes], ring, bright=2600, attack=0.05), cta, 0.3)
    mus.add(sub(hz(root), 1.6) * np.exp(-t_axis(1.6) * 1.5), cta, 0.5)
    drm.add(kick(1.2), cta, 0.9)
    for i, n in enumerate(notes):
        mus.add(piano(hz(n), 5.0, vel=0.7), cta + i * 0.045, 0.25, pan=-0.4 + i * 0.2)
    for n, beat in [("A5", 2), ("F#5", 3), ("E5", 4), ("D5", 6)]:
        mus.add(piano(hz(n), 3.5, vel=0.55), humanize(cta + beat * BEAT), 0.26)
    # tiny kick on the URL pop
    drm.add(kick(0.8), fr(CUE["url"]), 0.4)

    return mus.x, drm.x


def build_sfx() -> np.ndarray:
    fx = Bus()
    # night: phone notifications
    fx.add(ping(hz("E6")), fr(CUE["notifMom"]), 0.25)
    fx.add(ping(hz("B5")), fr(CUE["notifMom"]) + 0.09, 0.2)
    fx.add(ping(hz("A5")), fr(CUE["notifStore"]), 0.2)
    fx.add(ping(hz("F5")), fr(CUE["notifStore"]) + 0.1, 0.16)  # the flat one: nothing sold
    for f in (CUE["notifMom"], CUE["notifStore"]):
        fx.add(lp(rng.standard_normal(int(0.2 * SR)), 180) * np.exp(-t_axis(0.2) * 12) * 0.8, fr(f), 0.25)  # buzz

    # grind: typing (the keystroke scripts in Grind.tsx: ~3 frames per char, bursts)
    for a, b, step in [(400, 440, 3), (430, 500, 3), (468, 545, 3), (540, 572, 4), (566, 620, 3), (640, 694, 3), (652, 690, 4)]:
        for f in range(a, b, step):
            fx.add(key_click(), fr(f + rng.uniform(-0.6, 0.6)), 0.16, pan=rng.uniform(-0.2, 0.2))
    # keycaps (KEYCAPS in Grind.tsx)
    for i, f in enumerate([420, 470, 510, 545, 575, 600, 622, 642, 660, 676, 690, 702]):
        fx.add(blip(520 + i * 25, 0.08, 0.7), fr(f), 0.12, pan=rng.uniform(-0.6, 0.6))
    # clock jumps: a heavy tick + low thud
    for i, f in enumerate(CUE["clockJumps"]):
        fx.add(tick(0.7) * 3, fr(f), 0.35)
        fx.add(kick(0.6), fr(f), 0.3 + i * 0.1)

    # the dot
    fx.add(blip(300, 0.4, 3.0) * 0.8, fr(CUE["dotCollapse"]), 0.2)
    # riser → bloom
    bloom = fr(CUE["bloom"])
    rs = 1.9
    fx.add(noise_sweep(rs, 300, 9000, "rise", 0.5), bloom - rs, 0.3)
    tr = t_axis(rs)
    tone = np.sin(2 * np.pi * np.cumsum(220 * 4 ** (tr / rs)) / SR) * (tr / rs) ** 3
    fx.add(tone, bloom - rs, 0.1)
    # impact
    fx.add(sub(38, 1.4) * np.exp(-t_axis(1.4) * 2.5), bloom + 0.06, 0.8)
    fx.add(noise_sweep(1.2, 9000, 2000, "fall", 0.8), bloom + 0.06, 0.18)

    # connect
    for i in range(3):
        fx.add(blip(880 + i * 220, 0.06, 1.2), fr(SC["connect"]["from"] + 10 + i * 5), 0.1, pan=-0.3 + i * 0.3)
    for f in range(CUE["urlTypeFrom"], CUE["urlTypeFrom"] + 52, 4):
        fx.add(key_click(), fr(f), 0.14)
    fx.add(tick(1.4) * 2.5, fr(CUE["urlSubmit"]), 0.3)
    fx.add(blip(hz("A5"), 0.12, 1.0), fr(CUE["detect"]), 0.18)
    fx.add(blip(hz("E6"), 0.2, 1.0), fr(CUE["detect"]) + 0.08, 0.18)
    fx.add(noise_sweep(0.7, 600, 5000, "whoosh", 0.7), fr(CUE["linkFrom"]), 0.18, pan=0.2)
    fx.add(bell(hz("D6"), 1.2, 1.2), fr(CUE["linkFrom"] + 38), 0.12)
    for i in range(8):
        fx.add(blip(hz("D6") * 2 ** (i / 12 * 2), 0.05, 1.1), fr(CUE["syncCounterFrom"] + i * 11 + 23), 0.06, pan=-0.5 + i / 7)

    # audit: tiles land, scan, scores
    for i in range(9):
        fx.add(tick(0.9), fr(SC["audit"]["from"] + 4 + i * 4 + 6), 0.14)
    fx.add(noise_sweep(1.9, 1500, 4000, "whoosh", 0.4), fr(CUE["scoresFrom"] - 20), 0.1)
    for i in range(9):
        fx.add(blip(hz("E5") * 2 ** (-(i % 3) / 12), 0.1, 0.85), fr(CUE["scoresFrom"] + i * CUE["scoreStep"] + 16), 0.1, pan=-0.4 + (i % 3) * 0.4)

    # generate
    g0 = SC["generate"]["from"]
    fx.add(noise_sweep(0.6, 800, 6000, "whoosh", 0.6), fr(g0 - 20), 0.16)
    fx.add(tick(1.4) * 2.5, fr(CUE["titleRewrite"] - 22), 0.3)
    for f in range(CUE["titleRewrite"], CUE["titleRewrite"] + 70, 2):
        fx.add(tick(2.2) * 0.9, fr(f), 0.07, pan=rng.uniform(-0.3, 0.3))
    for i in range(5):
        fx.add(blip(hz("A5") * 2 ** (i * 2 / 12), 0.07, 1.1), fr(CUE["titleRewrite"] + 70 + i * 5 + 4), 0.1)
    fx.add(noise_sweep(0.7, 2000, 10000, "whoosh", 0.5), fr(CUE["imageWipe"]), 0.16)
    for k, n in enumerate(["D6", "F#6", "A6"]):
        fx.add(bell(hz(n), 1.0, 1.0), fr(CUE["imageWipe"]) + 0.3 + k * 0.05, 0.05)
    fx.add(tick(1.4) * 2.5, fr(CUE["approveClick"]), 0.3)
    for k, n in enumerate(["D5", "F#5", "A5", "D6"]):
        fx.add(bell(hz(n), 1.4, 1.4, 2.0), fr(CUE["applied"]) + k * 0.06, 0.1)
    for k in range(6):
        fx.add(blip(hz("A5") * 2 ** (k * 2 / 12), 0.08, 1.05), fr(CUE["scoreJump"]) + k * 0.05, 0.08, pan=-0.5 + k * 0.2)

    # bulk: cards flip
    for i in range(8):
        fx.add(noise_sweep(0.18, 2500, 7000, "whoosh", 0.5), fr(CUE["bulkFrom"] + i * CUE["bulkStep"] + 8), 0.1, pan=-0.6 + i * 0.17)
        fx.add(blip(hz("D6") * 2 ** (i / 12 * 1.5), 0.05), fr(CUE["bulkFrom"] + i * CUE["bulkStep"] + 18), 0.06)
    for k, n in enumerate(["D5", "A5", "D6", "F#6"]):
        fx.add(bell(hz(n), 1.6, 1.2, 2.0), fr(CUE["bulkFrom"] + 100) + k * 0.04, 0.09)
    # whoosh into dawn
    fx.add(noise_sweep(1.0, 400, 3000, "whoosh", 0.6), fr(SC["morning"]["from"]) - 0.6, 0.18)

    # morning orders: bright double chimes, climbing
    for k in range(4):
        f = CUE["ordersFrom"] + k * CUE["orderStep"]
        fx.add(ping(hz("A5") * 2 ** (k * 2 / 12)), fr(f), 0.2)
        fx.add(ping(hz("E6") * 2 ** (k * 2 / 12)), fr(f) + 0.08, 0.16)
        fx.add(lp(rng.standard_normal(int(0.2 * SR)), 180) * np.exp(-t_axis(0.2) * 12) * 0.8, fr(f), 0.18)
    fm = CUE["ordersFrom"] + CUE["orderStep"] * 4 + 14
    fx.add(ping(hz("B5")), fr(fm), 0.2)
    fx.add(ping(hz("E6")), fr(fm) + 0.09, 0.2)  # Mom, now resolved upward

    # end card
    fx.add(noise_sweep(1.0, 1500, 9000, "whoosh", 0.5), fr(CUE["logoDraw"]), 0.12)
    fx.add(blip(hz("D6"), 0.1, 1.0), fr(CUE["url"]), 0.12)
    fx.add(bell(hz("A6"), 1.2, 0.8), fr(CUE["url"] + 30), 0.05)
    return fx.x


def tape_stop(x: np.ndarray, at: float, dur: float = 0.55) -> np.ndarray:
    """Slow the buffer to a halt from `at`, then silence."""
    i0 = int(at * SR)
    n = int(dur * SR)
    rate = np.linspace(1, 0, n) ** 1.3
    pos = i0 + np.cumsum(rate)
    idx = np.clip(pos.astype(int), 0, len(x) - 2)
    frac = (pos - idx)[:, None]
    seg = x[idx] * (1 - frac) + x[idx + 1] * frac
    seg = seg * np.linspace(1, 0.2, n)[:, None]
    y = x.copy()
    y[i0 : i0 + n] = seg
    y[i0 + n :] = 0
    return y


def build_vo() -> tuple[np.ndarray, np.ndarray]:
    vo = Bus()
    for l in VO["lines"]:
        x, sr = sf.read(ROOT / "audio" / "cache" / "vo" / f"{l['id']}.wav", dtype="float64")
        assert sr == SR
        x = hp(x, 90)
        # gentle compression-ish: soft clip the peaks toward the RMS
        x = x / (np.abs(x).max() + 1e-9)
        x = np.tanh(x * 1.6) / np.tanh(1.6)
        vo.add(x, fr(l["at"]), 0.5)
    v = vo.x
    env = np.abs(v).mean(1)
    k = int(0.15 * SR)
    env = np.convolve(env, np.ones(k) / k, mode="same")
    duck = np.clip(env / (env.max() + 1e-9) * 6, 0, 1)
    # smooth attack/release
    duck = np.convolve(duck, np.hanning(int(0.25 * SR)) / np.hanning(int(0.25 * SR)).sum(), mode="same")
    return v, duck


def limiter(x: np.ndarray, ceiling: float) -> np.ndarray:
    peak = np.abs(x).max(1)
    look = int(0.005 * SR)
    need = np.maximum(1, peak / ceiling)
    need = np.array([need[max(0, i - look) : i + look].max() for i in range(0, len(need), look)])
    need = np.repeat(need, look)[: len(x)]
    rel = np.exp(-1 / (0.08 * SR / look))
    g = np.empty_like(need)
    cur = 1.0
    for i in range(0, len(need), look):
        target = need[i]
        cur = target if target > cur else cur * rel + target * (1 - rel)
        g[i : i + look] = cur
    return x / g[:, None]


def main() -> None:
    print("music…")
    mus, drm = build_music()
    print("sfx…")
    fx = build_sfx()
    print("vo…")
    vo, duck = build_vo()

    # kick pumps the music (sidechain feel) in the drop
    kenv = np.zeros(N)
    drop, morning = fr(SC["connect"]["from"]), fr(SC["morning"]["from"])
    for t in np.arange(drop, morning, BEAT):
        i = int(t * SR)
        seg = 1 - 0.35 * np.exp(-t_axis(BEAT) * 12)
        kenv[i : i + len(seg)] = seg[: N - i]
    kenv[kenv == 0] = 1

    music = mus * kenv[:, None] + drm
    music = tape_stop(music, fr(CUE["freeze"]))
    # the post-freeze pad/piano were silenced by the tape stop: re-render them
    pmus, pdrm = mus.copy(), drm.copy()
    post_from = int(fr(CUE["dotCollapse"]) * SR)
    music[post_from:] = (pmus * kenv[:, None] + pdrm)[post_from:]

    ir_big = reverb_ir(2.8, 6000)
    ir_room = reverb_ir(0.7, 7000)
    music = music + 0.28 * reverb(music, ir_big)
    fx = fx + 0.22 * reverb(fx, ir_big)
    vo = vo + 0.06 * reverb(vo, ir_room)

    music *= (1 - 0.55 * duck)[:, None]
    mix = 0.8 * music + 0.9 * fx + 1.0 * vo
    mix = hp(mix.T, 25).T

    # fade the tail out at the very end
    end = int(DUR * SR)
    mix = mix[:end]
    fade = int(0.35 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2

    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mix)
    mix *= 10 ** ((-14 - lufs) / 20)
    mix = limiter(mix, 10 ** (-1.2 / 20))
    lufs2 = meter.integrated_loudness(mix)
    mix *= 10 ** ((-14 - lufs2) / 20)
    mix = np.clip(mix, -0.89, 0.89)
    print(f"loudness {meter.integrated_loudness(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS")

    out = ROOT / "public" / "audio" / "mix.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, mix.astype(np.float32), SR, subtype="PCM_24")
    print("wrote", out)

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(2, 1, figsize=(18, 7), sharex=True)
    ax[0].specgram(mix.mean(1), NFFT=2048, Fs=SR, noverlap=1024, cmap="magma", vmin=-120)
    ax[0].set_ylim(0, 12000)
    rms = np.sqrt(np.convolve(mix.mean(1) ** 2, np.ones(4800) / 4800, mode="same"))
    ax[1].plot(np.arange(len(rms)) / SR, 20 * np.log10(rms + 1e-6), lw=0.6)
    for name, s in SC.items():
        ax[1].axvline(s["from"] / FPS, color="r", lw=0.5)
        ax[1].text(s["from"] / FPS, -10, name, fontsize=8)
    for l in VO["lines"]:
        ax[1].axvspan(l["at"] / FPS, (l["at"] + l["durationInFrames"]) / FPS, color="g", alpha=0.15)
    ax[1].set_ylim(-60, 0)
    fig.tight_layout()
    fig.savefig(ROOT / "out" / "audio-check.png", dpi=80)


if __name__ == "__main__":
    main()
