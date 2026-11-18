"""Round 7b (15 Nov): the film's sound effects made in code (numpy + scipy), as a fallback to the AI effects.

Usage: python3 video/experiments/sfx_synth_r7b.py
No AI audio, no recordings, no downloads, no network. Every effect has a fixed seed, so the same script always
writes the same files. Writes experiments/sfx-synth/NAME.wav (48 kHz, 24-bit, stereo) with the names mix_r7.py
places (comparator_clack as four variants _a.._d), and sfx-synth/sheet.png (one spectrogram per effect).

Each sound is a small physical model: a short noise burst (the strike) exciting a few damped resonances (the
object), or noise shaped by a moving band-pass (air, sliding). Spot effects start with LEAD s of silence so the
mix's 15 ms fade-in never touches the strike; the mix starts them LEAD s early so the strike lands on its frame.
"""
import wave
import zlib
from pathlib import Path

import numpy as np
from scipy import signal

EXP = Path(__file__).resolve().parent
OUT = EXP / "sfx-synth"
SR = 48000
LEAD = 0.020  # silence before every spot effect's strike (mix_r7b.py starts the clip this much earlier)


def rng(name):
    return np.random.default_rng(zlib.crc32(name.encode()))


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def bp(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], "bandpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x, axis=0)


def lp(x, f, order=4):
    return signal.sosfilt(signal.butter(order, f, "lowpass", fs=SR, output="sos"), x, axis=0)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "highpass", fs=SR, output="sos"), x, axis=0)


def pink(r, n):
    """1/f noise, shaped in the frequency domain."""
    spec = np.fft.rfft(r.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec[1:] /= np.sqrt(f[1:])
    spec[0] = 0
    x = np.fft.irfft(spec, n)
    return x / np.abs(x).max()


def brown(r, n):
    x = np.cumsum(r.standard_normal(n))
    x = hp(x, 20, 2)
    return x / np.abs(x).max()


def drift(r, n, rate, depth_db):
    """A slow, uneven level wander: smoothed random points, depth in dB either way."""
    pts = r.uniform(-1, 1, int(n / SR * rate) + 3)
    x = np.interp(np.arange(n) / SR * rate, np.arange(len(pts)), pts)
    x = np.convolve(x, np.ones(SR // 10) / (SR // 10), "same")
    return 10 ** (depth_db * x / 20)


def burst(r, sec, lo, hi, shape="hann"):
    """A short strike: noise, band-passed, under a hann (or a fast-decay) envelope."""
    n = max(8, int(sec * SR))
    x = bp(r.standard_normal(n + 400), lo, hi, 2)[400:]
    env = np.hanning(n) if shape == "hann" else np.exp(-np.arange(n) / (n / 4)) * np.minimum(1, np.arange(n) / 24)
    return x * env / (np.abs(x * env).max() + 1e-12)


def modes(freqs, decays, amps, sec, phases=None):
    """Impulse response of damped resonances: sum of a * exp(-t / tau) * sin(2 pi f t + phase)."""
    t = t_axis(sec)
    ph = np.zeros(len(freqs)) if phases is None else phases
    return sum(a * np.exp(-t / d) * np.sin(2 * np.pi * f * t + p) for f, d, a, p in zip(freqs, decays, amps, ph))


def moving_band(x, centre, width_oct):
    """Filter x through a band-pass whose centre (Hz, one value per sample) moves: STFT, a gaussian window
    in log frequency per frame, inverse STFT."""
    nper = 1024
    f, tt, Z = signal.stft(x, SR, nperseg=nper, noverlap=nper * 3 // 4)
    c = np.interp(tt * SR, np.arange(len(centre)), centre)
    lf = np.log2(np.maximum(f, 1.0))[:, None]
    gain = np.exp(-0.5 * ((lf - np.log2(c)[None, :]) / (width_oct / 2.355)) ** 2)
    _, y = signal.istft(Z * gain, SR, nperseg=nper, noverlap=nper * 3 // 4)
    return y[:len(x)]


def pad_lead(x, lead=LEAD):
    return np.concatenate([np.zeros((int(lead * SR),) + x.shape[1:]), x])


def place(buf, x, at):
    i = int(at * SR)
    buf[i:i + len(x)] += x[:len(buf) - i]


def finish(x, peak_db, fade_in=0.005, fade_out=0.015, width=None):
    """Mono or stereo in, stereo out: DC removed with a window (ends stay at zero), fades, peak set."""
    x = np.asarray(x, float)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    n = len(x)
    w = np.hanning(n)
    x = x - x.mean(axis=0) * (w / w.mean())[:, None]
    env = np.ones(n)
    a, b = int(fade_in * SR), int(fade_out * SR)
    env[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    env[n - b:] = np.minimum(env[n - b:], 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b))
    x = x * env[:, None]
    x = x - x.mean(axis=0) * (w * env / (w * env).mean())[:, None]  # the fades shift the mean a little: again
    return x * (10 ** (peak_db / 20) / np.abs(x).max())


# ---- the effects --------------------------------------------------------------------------------------------

def clack(r, k=1.0, gap=0.012, octave=1.0):
    """A wooden/mechanical tick: two short strikes, 12 ms apart, into three damped resonances."""
    ex = np.zeros(int(0.03 * SR))
    b1 = burst(r, 0.003 / octave, 800, 9000)
    b2 = burst(r, 0.008 / octave, 500, 6000, "decay") * 0.55
    place(ex, b1, 0.0)
    place(ex, b2, gap / octave)
    f = np.array([190, 640, 1900]) * k * octave
    ir = modes(f, np.array([0.060, 0.035, 0.020]) / octave, [0.55, 1.0, 0.6], 0.25, r.uniform(0, 2 * np.pi, 3))
    y = signal.fftconvolve(ex, ir)[:int(0.2 * SR)]
    y = y / np.abs(y).max() + 0.25 * np.pad(ex, (0, len(y) - len(ex)))  # a little of the strike itself
    return y


def comparator_clack(v):
    r = rng(f"comparator_clack_{v}")
    k = 1 + r.uniform(-0.04, 0.04)
    gap = 0.012 * (1 + r.uniform(-0.06, 0.06))
    return finish(pad_lead(clack(r, k, gap)), -3)


def plates_slide():
    r = rng("plates_slide")
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    centre = 2200 * (900 / 2200) ** (t / t[-1])  # falls from 2.2 kHz to 900 Hz
    x = moving_band(r.standard_normal(n), centre, 1.1)
    x = bp(x, 600, 3000, 2)
    env = np.sin(np.pi * np.minimum(1, t / 1.15)) ** 0.7 * drift(r, n, 7, 3.5)  # slow, a little uneven
    env *= 1 + 0.25 * np.sin(2 * np.pi * 13 * t + r.uniform(0, 6)) * np.exp(-t / 0.5)  # the plate catching early
    x = x * env / np.abs(x * env).max()
    tail = clack(r, 1.06)
    out = np.zeros(n + len(tail))
    out[:n] = x * 0.55
    place(out, tail * 0.5, 1.12)
    return finish(pad_lead(out), -4, 0.010)


def glass_ping():
    r = rng("glass_ping")
    f0 = 2100
    ratios = np.array([1, 2.76, 5.40, 8.93])
    f = f0 * ratios * (1 + r.uniform(-0.003, 0.003, 4))
    ring = modes(f, [0.9, 0.5, 0.28, 0.15], [1.0, 0.45, 0.25, 0.10], 1.4, r.uniform(0, 2 * np.pi, 4))
    ring *= np.minimum(1, np.arange(len(ring)) / (0.0006 * SR))  # 0.6 ms onset, so the ring itself has no click
    strike = np.zeros(len(ring))
    place(strike, burst(r, 0.001, 3000, 12000) * 0.18, 0)
    return finish(pad_lead(ring + strike), -4, fade_out=0.05)


def air_whoosh():
    r = rng("air_whoosh")
    n = int(1.3 * SR)
    t = np.arange(n) / SR
    u = t / t[-1]
    lf = np.where(u < 0.55, np.log(250) + (np.log(1100) - np.log(250)) * np.sin(np.pi / 2 * u / 0.55),
                  np.log(1100) + (np.log(350) - np.log(1100)) * np.sin(np.pi / 2 * (u - 0.55) / 0.45))
    centre = np.exp(lf)
    env = 0.5 - 0.5 * np.cos(2 * np.pi * u)  # raised cosine
    env = env ** 1.3
    ch = []
    pan = 0.5 + 0.35 * np.tanh(4 * (u - 0.5))  # passes left to right
    base = pink(r, n)
    for side, g in ((0, np.sqrt(1 - pan)), (1, np.sqrt(pan))):
        x = moving_band(0.8 * base + 0.2 * pink(r, n), centre, 1.0)
        ch.append(hp(x, 150, 4) * env * g)
    return finish(np.stack(ch, axis=1), -5, 0.010, 0.030)


def click(r, k=1.0):
    ex = burst(r, 0.002, 1500, 12000)
    ir = modes(np.array([2400, 5000]) * k, [0.0035, 0.0018], [1.0, 0.7], 0.012, r.uniform(0, 6, 2))
    y = signal.fftconvolve(ex, ir)
    return y / np.abs(y).max() + 0.15 * np.pad(ex, (0, len(y) - len(ex)))


def mouse_click():
    r = rng("mouse_click")
    out = np.zeros(int(0.12 * SR))
    place(out, click(r, 1.0), 0)
    place(out, click(r, 1.07) * 10 ** (-4 / 20), 0.065)  # the release: higher, 4 dB softer
    return finish(pad_lead(out), -3)


def shutter():
    r = rng("shutter")
    out = np.zeros(int(0.12 * SR))
    place(out, burst(r, 0.010, 1500, 5000, "decay"), 0)
    place(out, burst(r, 0.016, 1500, 5000, "decay") * 0.7, 0.038)
    t = t_axis(0.06)
    thump = np.sin(2 * np.pi * 90 * t) * np.exp(-t / 0.012) * np.minimum(1, t / 0.002)
    place(out, thump * 10 ** (-18 / 20) / np.abs(thump).max(), 0.0)
    out = lp(out, 7000, 2)  # cloth, not metal
    return finish(pad_lead(out), -3)


def counter_roll():
    r = rng("counter_roll")
    gaps = 0.055 + (0.160 - 0.055) * np.linspace(0, 1, 8) ** 1.6  # eases from 55 ms to 160 ms
    at = np.concatenate([[0], np.cumsum(gaps)])
    out = np.zeros(int((at[-1] + 0.15) * SR))
    for i, a in enumerate(at):
        tick = clack(r, 1 + r.uniform(-0.03, 0.03), 0.012, octave=2.0)
        place(out, tick * 10 ** ((-8 - 1.5 * i / 8 + r.uniform(-1, 1)) / 20), a)  # 8 dB softer than a clack
    return finish(pad_lead(out), -6)


def glass_shimmer():
    r = rng("glass_shimmer")
    n = int(2.6 * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    starts = np.sort(1.6 * r.uniform(0, 1, 14) ** 0.8)
    freqs = np.exp(r.uniform(np.log(1800), np.log(7000), 14))
    for s, f in zip(starts, freqs):
        d = r.uniform(0.5, 1.2)
        tt = t_axis(min(2.6 - s, 6 * d))
        p = np.exp(-tt / d) * np.sin(2 * np.pi * f * tt + r.uniform(0, 2 * np.pi))
        p += 0.3 * np.exp(-tt / (d * 0.6)) * np.sin(2 * np.pi * f * 2.41 * tt + r.uniform(0, 2 * np.pi))
        p *= np.minimum(1, tt / 0.002) * (0.4 + 0.6 * s / 1.6)  # later partials a little louder: it rises
        pan = r.uniform(0.15, 0.85)
        i = int(s * SR)
        m = min(len(p), n - i)
        out[i:i + m, 0] += p[:m] * np.sqrt(1 - pan)
        out[i:i + m, 1] += p[:m] * np.sqrt(pan)
    env = np.minimum(1, t / 1.4) ** 1.5 * np.clip((2.5 - t) / 0.9, 0, 1) ** 1.5  # rises, gone by 2.5 s
    return finish(out * env[:, None], -6, 0.010, 0.050)


def low_swell():
    r = rng("low_swell")
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    x = np.stack([lp(brown(r, n), 180, 4), lp(brown(r, n), 180, 4)], axis=1)
    x = hp(x, 35, 2)
    env = np.sin(np.pi * t / 2.5) ** 2 * (t / 2.5 + 0.3)  # swells, peak a little after the middle
    return finish(x * env[:, None], -8, 0.010, 0.050)


def screen_tap():
    r = rng("screen_tap")
    t = t_axis(0.06)
    thump = np.sin(2 * np.pi * 140 * t) * np.exp(-t / 0.009) * np.minimum(1, t / 0.0015)
    thump = thump / np.abs(thump).max()
    out = thump.copy()
    place(out, burst(r, 0.001, 2000, 9000) * 10 ** (-14 / 20), 0.0005)
    return finish(pad_lead(out), -3)


def warm_chime():
    r = rng("warm_chime")
    f0 = 470
    ratios = np.array([1, 2.71, 5.15, 8.1])
    decays = [3.0, 1.9, 1.1, 0.6]
    amps = [1.0, 0.5, 0.22, 0.09]
    sec = 3.4
    t = t_axis(sec)
    ring = np.zeros((len(t), 2))
    for q, (k, d, a) in enumerate(zip(ratios, decays, amps)):
        for side, det in ((0, -0.6), (1, 0.6)):  # each mode a pair 1.2 Hz apart: a slow beat
            ph = r.uniform(0, 2 * np.pi)
            for c, w in ((0, 0.6 + 0.4 * side), (1, 1.0 - 0.4 * side)):
                ring[:, c] += w * a * np.exp(-t / d) * np.sin(2 * np.pi * (f0 * k + det) * t + ph)
    attack = int(0.008 * SR)
    ring[:attack] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(attack) / attack))[:, None]  # soft mallet
    mallet = lp(burst(r, 0.006, 200, 2000, "decay"), 1500, 2) * 0.05
    ring[:len(mallet)] += mallet[:, None]
    return finish(pad_lead(ring), -4, 0.008, 0.15)


def room_tone():
    r = rng("room_tone")
    n = int(6.0 * SR)
    a, b = brown(r, n), brown(r, n)
    x = np.stack([0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b], axis=1)
    x = hp(lp(x, 250, 4), 30, 2) * drift(r, n, 0.4, 1.5)[:, None]
    return finish(x, -14, 0.5, 0.5)


def night_air():
    r = rng("night_air")
    n = int(7.0 * SR)
    t = np.arange(n) / SR
    a, b = pink(r, n), pink(r, n)
    air = np.stack([0.8 * a + 0.2 * b, 0.2 * a + 0.8 * b], axis=1)
    air = hp(lp(air, 500, 4), 40, 2) * drift(r, n, 0.3, 2.5)[:, None]
    air_rms = np.sqrt(np.mean(air ** 2))
    crick = np.zeros((n, 2))
    for f, rate, pan, off in ((4600, 2.1, 0.3, 0.13), (5100, 1.8, 0.75, 0.41)):
        gate = np.zeros(n)
        pulse = np.hanning(int(0.014 * SR))
        s = off
        while s < 7.0 - 0.2:
            for j in range(3):  # a chirp: 3 pulses, 30 ms apart
                i = int((s + 0.030 * j) * SR)
                gate[i:i + len(pulse)] = np.maximum(gate[i:i + len(pulse)], pulse * (1 - 0.15 * j))
            s += 1 / rate * (1 + r.uniform(-0.08, 0.08))
        tone = np.sin(2 * np.pi * f * t * (1 + 0.002 * np.sin(2 * np.pi * 0.2 * t))) * gate
        crick[:, 0] += tone * np.sqrt(1 - pan)
        crick[:, 1] += tone * np.sqrt(pan)
    crick = lp(crick, 6500, 2)  # far away
    crick *= air_rms * 10 ** (-20 / 20) / np.sqrt(np.mean(crick ** 2))  # 20 dB under the air
    return finish(air + crick, -12, 0.5, 0.5)


EFFECTS = {**{f"comparator_clack_{v}": (lambda v=v: comparator_clack(v)) for v in "abcd"},
           "plates_slide": plates_slide, "glass_ping": glass_ping, "air_whoosh": air_whoosh,
           "mouse_click": mouse_click, "shutter": shutter, "counter_roll": counter_roll,
           "glass_shimmer": glass_shimmer, "low_swell": low_swell, "screen_tap": screen_tap,
           "warm_chime": warm_chime, "room_tone": room_tone, "night_air": night_air}


def write_wav(path, x):
    q = np.round(np.clip(x, -1, 1 - 2 ** -23) * 2 ** 23).astype("<i4")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(q.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())


def stats(x):
    m = x.mean(axis=1)
    spec = np.abs(np.fft.rfft(m))
    f = np.fft.rfftfreq(len(m), 1 / SR)
    return {"seconds": len(x) / SR, "peak": 20 * np.log10(np.abs(x).max()),
            "rms": 20 * np.log10(np.sqrt(np.mean(x ** 2))), "centroid": float((f * spec).sum() / spec.sum()),
            "mean": float(np.abs(x.mean(axis=0)).max()), "ends": float(max(np.abs(x[0]).max(), np.abs(x[-1]).max()))}


def sheet(clips):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(4, 4, figsize=(16, 12))
    for ax, (name, x) in zip(axes.ravel(), clips.items()):
        m = x.mean(axis=1)
        nper = 256 if len(m) < SR // 2 else 1024
        f, tt, S = signal.spectrogram(m, SR, nperseg=nper, noverlap=nper * 7 // 8)
        db = 10 * np.log10(S + 1e-14)
        ax.pcolormesh(tt, f / 1000, db, vmin=db.max() - 70, vmax=db.max(), shading="auto", cmap="magma")
        ax.set_ylim(0, 12)
        ax.set_title(f"{name}  ({len(m) / SR:.2f} s)", fontsize=10)
        ax.set_xlabel("s", fontsize=8)
        ax.set_ylabel("kHz", fontsize=8)
        ax.tick_params(labelsize=7)
    for ax in axes.ravel()[len(clips):]:
        ax.axis("off")
    fig.suptitle("Slowsky film r7b: synthesised effects (0-12 kHz, 70 dB range)")
    fig.tight_layout()
    fig.savefig(OUT / "sheet.png", dpi=90)


def main():
    OUT.mkdir(exist_ok=True)
    clips, bad = {}, []
    print(f"{'effect':20s} {'sec':>5s} {'peak':>6s} {'rms':>6s} {'centroid':>8s}  checks")
    for name, fn in EFFECTS.items():
        x = fn()
        write_wav(OUT / f"{name}.wav", x)
        clips[name] = x
        s = stats(x)
        checks = []
        if s["peak"] > -1:
            checks.append("PEAK > -1 dBFS")
        if s["mean"] >= 1e-4:
            checks.append(f"DC {s['mean']:.1e}")
        if s["ends"] > 1e-4:
            checks.append(f"ends not silent {s['ends']:.1e}")
        bad += [f"{name}: {c}" for c in checks]
        print(f"{name:20s} {s['seconds']:5.2f} {s['peak']:6.1f} {s['rms']:6.1f} {s['centroid']:7.0f}Hz  "
              f"{', '.join(checks) or 'ok'}")
    sheet(clips)
    if bad:
        raise SystemExit("sfx_synth_r7b.py: checks failed:\n  " + "\n  ".join(bad))


if __name__ == "__main__":
    main()
