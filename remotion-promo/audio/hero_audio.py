"""Soundtrack for the hero story loop (music + SFX, no voice), reusing the promo's instruments.

Reads src/hero/hero-timeline.json, writes public/audio/hero.wav (48 kHz stereo, -16 LUFS).
The reverb tail past the last frame is folded back onto the start so the loop is seamless.
Harmony: night Bm7 | Gmaj7 | Em7 | F#7 → tape-stop → drop D | A | Bm | G | D | A → morning G | A → Dmaj9.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

import build as b

ROOT = Path(__file__).resolve().parent.parent
T = json.loads((ROOT / "src" / "hero" / "hero-timeline.json").read_text(encoding="utf-8"))
S, A = T["story"], T["app"]
SR, FPS = b.SR, T["fps"]
BEAT = 60 / T["bpm"]
BAR = BEAT * 4
DUR = T["durationInFrames"] / FPS
TAIL = 3.0
b.N = int((DUR + TAIL) * SR)  # Bus() sizes itself from build.N
hz, piano, pad, pluck, bell, kick, clap, hat, sub = b.hz, b.piano, b.pad, b.pluck, b.bell, b.kick, b.clap, b.hat, b.sub
blip, tick, ping, key_click, noise_sweep, t_axis = b.blip, b.tick, b.ping, b.key_click, b.noise_sweep, b.t_axis
CH = b.CHORDS
rng = np.random.default_rng(11)


def fr(f: float) -> float:
    return f / FPS


def app(f: float) -> float:
    return fr(S["appFrom"] + f)


def music() -> tuple[np.ndarray, np.ndarray]:
    mus, drm = b.Bus(), b.Bus()
    freeze, drop = fr(S["freeze"]), fr(S["appFrom"])
    morning, cta = fr(S["appTo"]), fr(S["ctaFrom"])
    arp = [0, 1, 2, 3, 2, 1, 2, 3]

    # night: felt piano over a dark pad, getting busier
    for bi, name in enumerate(["Bm7", "Gmaj7", "Em7", "F#7"]):
        t0 = bi * BAR
        root, notes = CH[name]
        dur = min(BAR, freeze - t0)
        mus.add(pad([hz(n) for n in notes[:3]], dur + 0.4, bright=900 + 250 * bi, attack=1.2 if bi == 0 else 0.4), t0, 0.33)
        mus.add(sub(hz(root), dur) * np.minimum(1, t_axis(dur) / 0.3), t0, 0.2 + 0.05 * bi)
        steps = 8 if bi < 2 else 16
        for s in range(steps):
            ts = t0 + s * BAR / steps
            if ts >= freeze:
                break
            vel = (0.35 if bi == 0 and s < 2 else 0.45) + 0.2 * (s % 4 == 0)
            octave = 2 if (s % 8 == 4 and bi < 2) else 1
            mus.add(piano(hz(notes[arp[s % 8]]) * octave, 2.2, vel=vel), ts + rng.uniform(-0.008, 0.008), 0.22, pan=rng.uniform(-0.3, 0.3))
        top = {"Bm7": "F#5", "Gmaj7": "D5", "Em7": "G5", "F#7": "A#4"}[name]
        mus.add(piano(hz(top), 3.0, vel=0.6), t0 + 0.01, 0.28, pan=0.1)
    t = fr(S["pagesFrom"])
    while t < freeze:
        drm.add(tick(1.2 if int(round(t / BEAT)) % 2 else 0.8), t, 0.1 + 0.2 * (t / freeze))
        t += BEAT
    for i, t in enumerate(np.arange(2 * BAR, freeze, BEAT)):
        drm.add(kick(0.5) * 0.5, t, 0.22 + 0.03 * i)

    # the dot
    dot = fr(S["dotCollapse"])
    mus.add(piano(hz("F#5"), 4.0, vel=0.5), dot + 0.05, 0.35)
    mus.add(piano(hz("B4"), 4.0, vel=0.4), dot + BEAT * 2, 0.25)
    mus.add(pad([hz("D4"), hz("A4"), hz("E5")], drop - dot + 0.2, bright=2500, attack=1.6), dot, 0.26)

    # the drop, under the app
    stabs = [0, 3, 6, 8, 11, 14]
    for bi, name in enumerate(["D", "A", "Bm", "G", "D", "A"]):
        t0 = drop + bi * BAR
        root, notes = CH[name]
        mus.add(pad([hz(n) for n in notes[:3]], BAR + 0.3, bright=1800, attack=0.15), t0, 0.16)
        for s in stabs:
            for n in notes:
                mus.add(pluck(hz(n), 0.45, bright=1.3), t0 + s * BAR / 16, 0.07, pan=rng.uniform(-0.4, 0.4))
        for s in range(8):
            mus.add(sub(hz(root) * (2 if s in (3, 7) else 1), BAR / 8 * 0.9), t0 + s * BAR / 8, 0.3)
        if bi >= 2:
            pat = [0, 1, 2, 3, 2, 1, 3, 2] * 2
            for s in range(16):
                mus.add(bell(hz(notes[pat[s] % len(notes)]) * 2, 0.8, idx=1.6), t0 + s * BAR / 16, 0.05, pan=0.5 if s % 2 else -0.5)
        for s in range(16):
            ts = t0 + s * BAR / 16
            if s % 4 == 0:
                drm.add(kick(), ts, 0.8)
            if s in (4, 12):
                drm.add(clap(), ts, 0.55, pan=0.05)
            drm.add(hat(open_=(s % 4 == 2)), ts, 0.2 if s % 2 else 0.1, pan=0.35)
    for i in range(8):
        drm.add(clap(), morning - BAR / 2 + i * BAR / 16, 0.18 + 0.05 * i)

    # morning breakdown
    for bi, name in enumerate(["G", "A"]):
        t0 = morning + bi * BAR
        root, notes = CH[name]
        mus.add(pad([hz(n) for n in notes[:4]], BAR + 0.4, bright=2200, attack=0.3), t0, 0.28)
        mus.add(sub(hz(root), BAR), t0, 0.25)
        for s in range(8):
            mus.add(piano(hz(notes[arp[s] % len(notes)]) * 2, 2.0, vel=0.5), t0 + s * BAR / 8, 0.18, pan=rng.uniform(-0.3, 0.3))
        drm.add(kick(0.7), t0, 0.5)
        drm.add(kick(0.7), t0 + BAR / 2, 0.4)
    for n, beat in [("F#5", 0), ("E5", 1.5), ("D5", 2), ("E5", 4), ("F#5", 5.5), ("A5", 6)]:
        mus.add(piano(hz(n), 2.5, vel=0.65), morning + beat * BEAT, 0.3)

    # end card: resolve
    root, notes = CH["Dmaj9"]
    mus.add(pad([hz(n) for n in notes], DUR - cta + 1.5, bright=2600, attack=0.05), cta, 0.3)
    mus.add(sub(hz(root), 1.6) * np.exp(-t_axis(1.6) * 1.5), cta, 0.5)
    drm.add(kick(1.2), cta, 0.9)
    for i, n in enumerate(notes):
        mus.add(piano(hz(n), 5.0, vel=0.7), cta + i * 0.045, 0.25, pan=-0.4 + i * 0.2)
    for n, beat in [("A5", 2), ("F#5", 3), ("E5", 4), ("D5", 6)]:
        mus.add(piano(hz(n), 3.5, vel=0.55), cta + beat * BEAT, 0.26)
    drm.add(kick(0.8), fr(S["url"]), 0.35)
    return mus.x, drm.x


def sfx() -> np.ndarray:
    fx = b.Bus()
    fx.add(bell(hz("F#6"), 2.0, 0.6), fr(8), 0.05)
    for i in range(9):
        fx.add(tick(0.9), fr(S["pagesFrom"] + 10 + i * 5 + 8), 0.14, pan=-0.5 + i / 8)
        fx.add(blip(hz("E5") * 2 ** (-(i % 3) / 12), 0.1, 0.85), fr(S["pagesFrom"] + 50 + i * 4), 0.07)
    for a, e, step in T["typing"]:
        for f in range(a, e, step):
            fx.add(key_click(), fr(f + rng.uniform(-0.6, 0.6)), 0.15, pan=rng.uniform(-0.2, 0.2))
    for i, f in enumerate(T["keycaps"]):
        fx.add(blip(520 + i * 22, 0.08, 0.7), fr(f), 0.11, pan=-0.6 if i % 2 == 0 else 0.6)
    for i, f in enumerate(S["clockJumps"]):
        fx.add(tick(0.7) * 3, fr(f), 0.35)
        fx.add(kick(0.6), fr(f), 0.3 + 0.1 * i)
    # the wall: blips thickening into a cloud
    wall0, wall1 = fr(S["timesFrom"]), fr(S["freeze"])
    for _ in range(60):
        fx.add(blip(rng.uniform(600, 1800), 0.05, 0.9), wall0 + (wall1 - wall0) * np.sqrt(rng.uniform()), 0.05, pan=rng.uniform(-0.8, 0.8))
    fx.add(noise_sweep(wall1 - wall0, 400, 3000, "rise", 0.6), wall0, 0.12)

    fx.add(blip(300, 0.4, 3.0) * 0.8, fr(S["dotCollapse"]), 0.2)
    bloom = fr(S["bloom"])
    rs = 1.5
    fx.add(noise_sweep(rs, 300, 9000, "rise", 0.5), bloom - rs, 0.3)
    tr = t_axis(rs)
    fx.add(np.sin(2 * np.pi * np.cumsum(220 * 4 ** (tr / rs)) / SR) * (tr / rs) ** 3, bloom - rs, 0.1)
    fx.add(sub(38, 1.4) * np.exp(-t_axis(1.4) * 2.5), bloom + 0.04, 0.8)
    fx.add(noise_sweep(1.2, 9000, 2000, "fall", 0.8), bloom + 0.04, 0.16)

    # the app
    for f in range(A["type"], A["type"] + 52, 4):
        fx.add(key_click(), app(f), 0.13)
    fx.add(tick(1.4) * 2.5, app(A["submit"]), 0.3)
    fx.add(blip(hz("A5"), 0.12), app(A["detect"]), 0.17)
    fx.add(blip(hz("E6"), 0.2), app(A["detect"]) + 0.08, 0.17)
    fx.add(noise_sweep(0.6, 700, 4000, "whoosh", 0.7), app(A["toApp"]), 0.14)
    for i in range(9):
        fx.add(tick(0.9), app(A["tilesFrom"] + i * 4 + 6), 0.12)
        fx.add(blip(hz("E5") * 2 ** (-(i % 3) / 12), 0.1, 0.85), app(A["scoresFrom"] + i * A["scoreStep"] + 14), 0.09, pan=-0.4 + (i % 3) * 0.4)
    for c in (A["select"], A["gen"], A["approve"], A["bulkClick"]):
        fx.add(tick(1.4) * 2.5, app(c), 0.3)
    fx.add(noise_sweep(0.5, 900, 5000, "whoosh", 0.6), app(A["select"] + 4), 0.13)
    for f in range(A["title"], A["title"] + 68, 2):
        fx.add(tick(2.2) * 0.9, app(f), 0.06, pan=rng.uniform(-0.3, 0.3))
    for i in range(5):
        fx.add(blip(hz("A5") * 2 ** (i * 2 / 12), 0.07, 1.1), app(A["title"] + 70 + i * 5 + 4), 0.09)
    fx.add(noise_sweep(0.7, 2000, 10000, "whoosh", 0.5), app(A["wipe"]), 0.15)
    for k, n in enumerate(["D6", "F#6", "A6"]):
        fx.add(bell(hz(n), 1.0, 1.0), app(A["wipe"]) + 0.3 + k * 0.05, 0.05)
    for k, n in enumerate(["D5", "F#5", "A5", "D6"]):
        fx.add(bell(hz(n), 1.4, 1.4, 2.0), app(A["applied"]) + k * 0.06, 0.1)
    for k in range(6):
        fx.add(blip(hz("A5") * 2 ** (k * 2 / 12), 0.08, 1.05), app(A["scoreJump"]) + k * 0.05, 0.08, pan=-0.5 + k * 0.2)
    for i in range(1, 9):
        at = A["bulkFrom"] + (i - 1) * A["bulkStep"]
        fx.add(noise_sweep(0.18, 2500, 7000, "whoosh", 0.5), app(at), 0.09, pan=-0.6 + i * 0.15)
        fx.add(blip(hz("D6") * 2 ** (i / 12 * 1.5), 0.05), app(at + 10), 0.06)
    for k, n in enumerate(["D5", "A5", "D6", "F#6"]):
        fx.add(bell(hz(n), 1.6, 1.2, 2.0), app(A["bulkFrom"] + 86) + k * 0.04, 0.09)

    # morning orders, Mom last
    for i in range(4):
        f = S["ordersFrom"] + i * S["orderStep"] + (14 if i == 3 else 0)
        if i < 3:
            up = 2 ** (i * 2 / 12)
            fx.add(ping(hz("A5") * up), fr(f), 0.2)
            fx.add(ping(hz("E6") * up), fr(f) + 0.08, 0.16)
        else:
            fx.add(ping(hz("B5")), fr(f), 0.2)
            fx.add(ping(hz("E6")), fr(f) + 0.09, 0.2)
    fx.add(noise_sweep(1.0, 1500, 9000, "whoosh", 0.5), fr(S["logoDraw"]), 0.12)
    fx.add(blip(hz("D6"), 0.1), fr(S["url"]), 0.12)
    return fx.x


def main() -> None:
    print("music")
    mus, drm = music()
    print("sfx")
    fx = sfx()
    kenv = np.ones(b.N)
    for t in np.arange(fr(S["appFrom"]), fr(S["appTo"]), BEAT):
        i = int(t * SR)
        seg = 1 - 0.35 * np.exp(-t_axis(BEAT) * 12)
        kenv[i : i + len(seg)] = seg[: b.N - i]
    m = mus * kenv[:, None] + drm
    post = int(fr(S["dotCollapse"]) * SR)
    stopped = b.tape_stop(m, fr(S["freeze"]), dur=0.28)  # must end before the dot note
    stopped[post:] = m[post:]
    ir = b.reverb_ir(2.8, 6000)
    m = stopped + 0.28 * b.reverb(stopped, ir)
    fx = fx + 0.22 * b.reverb(fx, ir)
    mix = 0.85 * m + 0.9 * fx
    mix = b.hp(mix.T, 25).T

    # fade with the picture's fade to night, then fold the tail onto the start
    end = int(DUR * SR)
    f0 = int(fr(S["fadeOut"]) * SR)
    env = np.ones(len(mix))
    env[f0:end] = np.linspace(1, 0.15, end - f0) ** 1.5
    env[end:] = 0.15
    mix *= env[:, None]
    tail = mix[end:]
    mix = mix[:end].copy()
    mix[: len(tail)] += tail

    meter = pyln.Meter(SR)
    mix *= 10 ** ((-16 - meter.integrated_loudness(mix)) / 20)
    mix = b.limiter(mix, 10 ** (-1.5 / 20))
    mix *= 10 ** ((-16 - meter.integrated_loudness(mix)) / 20)
    mix = np.clip(mix, -0.86, 0.86)
    print(f"{meter.integrated_loudness(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.1f} dBFS")
    out = ROOT / "public" / "audio" / "hero.wav"
    sf.write(out, mix.astype(np.float32), SR, subtype="PCM_24")
    print("wrote", out)


if __name__ == "__main__":
    main()
