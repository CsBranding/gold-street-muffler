import '@fontsource/lilita-one/400.css';
import './ui/styles.css';
import { App } from './game/app';
import { ConfigError, loadConfig } from './schema/loadConfig';

const root = document.getElementById('app')!;
try {
  const cfg = loadConfig();
  const app = new App(root, cfg);
  if (import.meta.env.DEV) (window as unknown as { __bw: App }).__bw = app;
  document.fonts?.ready.finally(() => app.start());
} catch (e) {
  root.innerHTML = `<pre class="config-error">${e instanceof ConfigError ? 'Config error:\n' : ''}${String((e as Error).message ?? e)}</pre>`;
  throw e;
}
