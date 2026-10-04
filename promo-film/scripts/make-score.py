"""Original deterministic 56s cinematic synth score, created for this campaign.
No downloaded music, loops, samples, or vocal tracks are used.
Run: uv run --with numpy scripts/make-score.py
"""
from pathlib import Path
import wave
import json
import numpy as np

SR = 48000
DURATION = 56
rng = np.random.default_rng(20261002)
mix = np.zeros((SR * DURATION, 2), dtype=np.float64)

def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def add(samples, start, gain=1, pan=0):
    start_i = int(round(start * SR))
    if start_i < 0:
        samples = samples[-start_i:]
        start_i = 0
    end = min(len(mix), start_i + len(samples))
    if end <= start_i:
        return
    samples = samples[:end-start_i]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    mix[start_i:end, 0] += samples * gain * left
    mix[start_i:end, 1] += samples * gain * right

def piano(midi, start, gain=0.14, length=2.2, pan=0):
    t = np.arange(int(length * SR)) / SR
    freq = hz(midi)
    sig = (np.sin(2*np.pi*freq*t)*np.exp(-1.65*t) +
           0.35*np.sin(2*np.pi*freq*2.005*t)*np.exp(-3.8*t) +
           0.13*np.sin(2*np.pi*freq*3.01*t)*np.exp(-5.2*t))
    sig *= np.minimum(1, t/0.006) * np.minimum(1, (length-t)/0.12)
    add(sig, start, gain, pan)
    add(sig, start+0.225, gain*0.16, -pan)
    add(sig, start+0.45, gain*0.07, pan)

def pad(chord, start, duration, gain=0.024):
    t = np.arange(int(duration*SR)) / SR
    env = np.minimum(1, t/1.5) * np.minimum(1, (duration-t)/1.5)
    for i, note in enumerate(chord):
        freq = hz(note)
        signal = (np.sin(2*np.pi*freq*t) + 0.38*np.sin(2*np.pi*(freq*1.002)*t) +
                  0.17*np.sin(2*np.pi*freq*2*t)) * env
        signal *= 0.85 + 0.15*np.sin(2*np.pi*0.21*t+i)
        add(signal, start, gain, (i-1.5)*0.27)

def bass(note, start, gain=0.075):
    t=np.arange(int(0.42*SR))/SR
    freq=hz(note)
    env=np.minimum(1,t/0.025)*np.exp(-6*t)*np.minimum(1,(0.42-t)/0.08)
    sig=(np.sin(2*np.pi*freq*t)+0.16*np.sin(2*np.pi*freq*2*t))*env
    add(sig,start,gain,0)

def kick(start, gain=0.13):
    t=np.arange(int(0.42*SR))/SR
    phase=2*np.pi*(43*t+70*(1-np.exp(-26*t))/26)
    sig=np.sin(phase)*np.exp(-11*t)*np.minimum(1,t/0.003)
    add(sig,start,gain)

def snare(start,gain=0.045):
    t=np.arange(int(0.17*SR))/SR
    noise=rng.normal(0,0.7,len(t))
    filtered=noise-np.roll(noise,1)*0.82
    sig=filtered*np.exp(-29*t)*np.minimum(1,t/0.002)
    sig+=0.3*np.sin(2*np.pi*185*t)*np.exp(-27*t)
    add(sig,start,gain,0.06)

def hat(start,gain=0.016):
    t=np.arange(int(0.055*SR))/SR
    noise=rng.normal(0,0.45,len(t))
    high=noise-np.roll(noise,1)
    add(high*np.exp(-85*t)*np.minimum(1,t/0.001),start,gain,-0.22)

def whoosh(cut):
    duration=0.75
    t=np.arange(int(duration*SR))/SR
    noise=rng.normal(0,0.3,len(t))
    # Soft lowpass noise plus a rising tonal shimmer, all locally synthesized.
    smooth=np.convolve(noise,np.ones(13)/13,mode='same')
    env=np.sin(np.pi*np.clip(t/duration,0,1))**2
    phase=2*np.pi*(150*t+350*t*t)
    sig=(smooth*0.6+np.sin(phase)*0.055)*env
    add(sig,cut-0.52,0.28,-0.3)
    add(sig,cut-0.49,0.2,0.3)
    kick(cut,0.12)

# D minor, Bb major, F major, C major; open voicings keep the score airy.
chords=[[50,57,60,65],[46,53,58,62],[48,55,60,64],[45,52,57,60]]
arps=[[74,77,81,84],[70,74,77,81],[72,76,79,84],[69,72,76,79]]

for bar in range(14):
    pad(chords[bar%4],bar*4-0.5,5.4,gain=0.015 if bar<2 else 0.023)

for start,note in [(0.3,74),(1.8,77),(3.0,81),(4.35,84),(5.6,77),(7.2,74),(8.7,81)]:
    piano(note,start,0.16,3.0,(-0.45 if int(start)%2 else 0.45))

for i in range(184):
    t=9.5+i*0.25
    if t>=54.5:
        break
    chord=int(t//4)%4
    note=arps[chord][[0,2,1,3,0,1,2,1][i%8]]
    gain=0.12 if 18.2<t<25.6 or 32<t<39.4 or 44.8<t<50.2 else 0.08
    if 39.4<t<44.8:
        gain*=0.45
    piano(note,t,gain,1.35,0.44*np.sin(i*0.7))

for i in range(112):
    t=i*0.5
    if t<10.8 or t>51:
        continue
    energy=0.9 if 18.2<t<25.6 or 32<t<39.4 or 44.8<t<50.2 else 0.58
    if 39.4<t<44.8:
        energy=0.23
    bass(chords[int(t//4)%4][0]-12,t,0.095*energy)
    kick(t,0.17*energy)
    if i%2==1:
        snare(t,0.07*energy)
    hat(t,0.028*energy)
    if energy>0.7:
        hat(t+0.25,0.018*energy)

for cut in [5.4,10.8,18.2,25.6,32,39.4,44.8,50.2]:
    whoosh(cut)

# Closing resolved chord and a long reverb-like tail.
for i,note in enumerate([50,57,62,65,69,74]):
    piano(note,50.2+i*0.06,0.17,5.4,(i-2.5)*0.16)
for i,note in enumerate([81,77,74]):
    piano(note,51.9+i*0.45,0.1,3.0,(i-1)*0.3)

# A short stereo delay gives depth without masking typography transitions.
delay=int(SR*0.31)
dry=mix.copy()
mix[delay:,0]+=dry[:-delay,1]*0.15
mix[delay:,1]+=dry[:-delay,0]*0.15
time=np.arange(len(mix))/SR
fade=np.minimum(1,time/0.35)*np.minimum(1,np.maximum(0,(DURATION-time)/1.35))
mix*=fade[:,None]
mix=np.tanh(mix*1.15)
mix*=0.87/max(np.max(np.abs(mix)),0.001)
pcm=(mix*32767).astype('<i2')
out=Path(__file__).resolve().parents[1]/'public'/'audio'/'score.wav'
out.parent.mkdir(parents=True,exist_ok=True)
with wave.open(str(out),'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SR)
    wav.writeframes(pcm.tobytes())
stats={'duration':DURATION,'sample_rate':SR,'channels':2,'peak_dbfs':round(20*np.log10(np.max(np.abs(mix))),2),'rms_dbfs':round(20*np.log10(np.sqrt(np.mean(mix*mix))),2),'bpm':120,'source':'Original deterministic synthesis; no third-party music samples.'}
(out.parent/'score-metadata.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
print(json.dumps(stats,indent=2))

