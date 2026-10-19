/** Every ad call goes through AdService so the SDK can be swapped without touching gameplay. */
export type RewardedPlacement = 'double_loot' | 'revive' | 'daily_chest' | 'double_offline';

export interface AdService {
  /** Resolves true when the reward should be granted. */
  showRewarded(placement: RewardedPlacement): Promise<boolean>;
  showInterstitial(): Promise<void>;
  /** interstitial frequency rule from economy.ads */
  shouldShowInterstitial(levelsPlayed: number): boolean;
}

/** Dev mock: a short fake ad overlay that always rewards. */
export class MockAdService implements AdService {
  constructor(private rules: { interstitialFreeLevels: number; interstitialEveryNLevels: number }, private host: HTMLElement) {}
  private overlay(text: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'mock-ad';
      el.innerHTML = `<div><b>AD</b><span>${text}</span><small>mock ad — dev build</small></div>`;
      this.host.appendChild(el);
      setTimeout(() => {
        el.remove();
        resolve();
      }, ms);
    });
  }
  async showRewarded(placement: RewardedPlacement): Promise<boolean> {
    await this.overlay(`Rewarded: ${placement.replace('_', ' ')}`, 1200);
    return true;
  }
  async showInterstitial(): Promise<void> {
    await this.overlay('Interstitial', 800);
  }
  shouldShowInterstitial(levelsPlayed: number): boolean {
    const r = this.rules;
    if (levelsPlayed <= r.interstitialFreeLevels) return false;
    return (levelsPlayed - r.interstitialFreeLevels) % r.interstitialEveryNLevels === 0;
  }
}
