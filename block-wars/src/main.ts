import '@fontsource/lilita-one/400.css';
import './ui/styles.css';
import { App } from './game/app';
import { ConfigError, loadConfig } from './schema/loadConfig';
import { loadKayKit } from './render/kaykit';

const root = document.getElementById('app')!;
try {
  const cfg = loadConfig();
  const models = loadKayKit();
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('viewer')) {
    const clip = new URLSearchParams(location.search).get('viewer') || 'run';
    void models.then(() => import('./dev/viewer').then((v) => v.runViewer(root, cfg, clip)));
  } else {
    const app = new App(root, cfg);
    if (import.meta.env.DEV) (window as unknown as { __bw: App }).__bw = app;
    void Promise.all([document.fonts?.ready, models]).finally(() => app.start());
  }
} catch (e) {
  root.innerHTML = `<pre class="config-error">${e instanceof ConfigError ? 'Config error:\n' : ''}${String((e as Error).message ?? e)}</pre>`;
  throw e;
}
