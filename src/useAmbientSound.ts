/**
 * useAmbientSound — auto-starts ambient audio on first user interaction.
 * Returns { muted, toggleMute, started } so the UI can render a mute button.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export function useAmbientSound(src: string, volume = 0.25) {
  const audioRef  = useRef<HTMLAudioElement | null>(null);
  const [started, setStarted] = useState(false);
  const [muted,   setMuted]   = useState(false);

  // Create audio element once
  useEffect(() => {
    const audio    = new Audio(src);
    audio.loop     = true;
    audio.volume   = volume;
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ''; };
  }, [src, volume]);

  // First-interaction trigger: attach once, fire on any click/keydown/scroll/touchstart
  useEffect(() => {
    let fired = false;

    const start = () => {
      if (fired) return;
      fired = true;
      const audio = audioRef.current;
      if (!audio) return;
      audio.play().then(() => {
        setStarted(true);
        // Fade in from 0 → target volume over 1.5s
        audio.volume = 0;
        const target = volume;
        const steps  = 30;
        let step     = 0;
        const timer  = setInterval(() => {
          step++;
          audio.volume = Math.min(target, (step / steps) * target);
          if (step >= steps) clearInterval(timer);
        }, 1500 / steps);
      }).catch(() => { /* blocked — user will interact again */ fired = false; });
    };

    const events = ['click', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, start, { once: false, passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, start));
  }, [volume]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted) {
      audio.volume = volume;
      setMuted(false);
    } else {
      audio.volume = 0;
      setMuted(true);
    }
  }, [muted, volume]);

  return { started, muted, toggleMute };
}
