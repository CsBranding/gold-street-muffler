/** Haptic ticks via the Vibration API (Capacitor Haptics swaps in for native builds). */
const canVibrate = () => !!navigator.vibrate && (navigator.userActivation?.hasBeenActive ?? true);

export class Haptics {
  enabled = true;
  private last = 0;
  tick(minGapMs = 70): void {
    if (!this.enabled || !canVibrate()) return;
    const now = performance.now();
    if (now - this.last < minGapMs) return;
    this.last = now;
    navigator.vibrate(8);
  }
  heavy(): void {
    if (this.enabled && canVibrate()) navigator.vibrate([30, 30, 60]);
  }
}
