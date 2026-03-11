/**
 * useAmbientSound — auto-starts ambient audio on first user interaction.
 * Returns { muted, toggleMute, started } so the UI can render a mute button.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export function useAmbientSound(src: string, volume = 0.08) {
  const audioRef  = useRef<HTMLAudioElement | null>(null);
  const [started, setStarted] = useState(false);
  const [muted,   setMuted]   = useState(false);

  // Create audio element once
  useEffect(() => {
    const audio  = new Audio(src);
    audio.loop   = true;
    audio.volume = 0;
    audio.muted  = false;
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ''; };
  }, [src]);  // intentionally omit volume — we manage it manually below

  // First-interaction trigger
  useEffect(() => {
    let fired = false;

    const start = () => {
      if (fired) return;
      fired = true;
      const audio = audioRef.current;
      if (!audio) return;
      audio.play().then(() => {
        setStarted(true);
        // Fade in to target volume over 2s
        const target = volume;
        const steps  = 40;
        let step     = 0;
        const timer  = setInterval(() => {
          step++;
          if (audioRef.current) {
            audioRef.current.volume = Math.min(target, (step / steps) * target);
          }
          if (step >= steps) clearInterval(timer);
        }, 2000 / steps);
      }).catch(() => { fired = false; });
    };

    const events = ['click', 'keydown', 'touchstart', 'scroll'] as const;
    events.forEach(e => window.addEventListener(e, start, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, start));
  }, [volume]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nowMuted = !audio.muted;
    audio.muted = nowMuted;
    setMuted(nowMuted);
  }, []);

  return { started, muted, toggleMute };
}
