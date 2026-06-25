/**
 * Web Audio API synthesizer for Mundo Dodgeball
 * Eliminates need for audio assets, generating everything procedurally.
 */

class AudioSynth {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  private init() {
    if (this.ctx) return;
    try {
      // Create audio context safely
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    } catch (e) {
      console.warn("Web Audio API is not supported in this browser.", e);
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    // Try to resume if unmuting
    if (!this.muted && this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public ensureContextResumed() {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  // 1. Aerodynamic "Whoosh" throw sound
  public playThrow() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      osc.type = "sine";
      
      // Pitch slides down rapidly to simulate a throwing whoosh
      osc.frequency.setValueAtTime(450, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.15);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.16);
    } catch (err) {
      console.error("Throw sound synthesis failed:", err);
    }
  }

  // 2. Heavy, satisfying "Thud" hit sound
  public playHit() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const noise = this.ctx.createBufferSource();
      const oscGain = this.ctx.createGain();
      const noiseGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      // Low pitch sine thud
      osc.type = "triangle";
      osc.frequency.setValueAtTime(150, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.25);

      oscGain.gain.setValueAtTime(0.5, this.ctx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

      // White noise component for punch impact
      const bufferSize = this.ctx.sampleRate * 0.1; // 100ms noise burst
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      noise.buffer = buffer;

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(300, this.ctx.currentTime);

      noiseGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

      osc.connect(oscGain);
      oscGain.connect(this.ctx.destination);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.26);

      noise.start();
      noise.stop(this.ctx.currentTime + 0.11);
    } catch (err) {
      console.error("Hit sound synthesis failed:", err);
    }
  }

  // 3. Bright, metallic "Ping" shield parry/reflection sound
  public playParry() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      
      // Combine multiple frequencies to simulate high-contrast metallic bell chime
      const freqs = [880, 1200, 1500, 2200];
      const decayTime = 0.45;

      freqs.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = idx === 0 ? "sine" : "triangle";
        osc.frequency.setValueAtTime(freq, now);
        
        // Slight frequency shift for a ringing feel
        osc.frequency.exponentialRampToValueAtTime(freq - 15, now + decayTime);

        // First osc holds the main power, others provide harmonics
        const volume = idx === 0 ? 0.2 : 0.08;
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + decayTime + 0.05);
      });
    } catch (err) {
      console.error("Parry sound synthesis failed:", err);
    }
  }

  // 4. Countdown alert beep
  public playCountdown(isGo: boolean = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      
      const pitch = isGo ? 880 : 440;
      const duration = isGo ? 0.35 : 0.15;

      osc.frequency.setValueAtTime(pitch, this.ctx.currentTime);
      
      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration + 0.05);
    } catch (err) {
      console.error("Countdown sound synthesis failed:", err);
    }
  }
}

export const audioSynth = new AudioSynth();
