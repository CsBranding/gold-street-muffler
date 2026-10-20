"""Pack dist/ into one self-contained HTML (CSS, font, JS and glTF models inlined) for previews."""
import base64, re, sys, pathlib
dist = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'dist')
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'dist/block-wars.html')
html = (dist / 'index.html').read_text()
b64 = lambda p: base64.b64encode(p.read_bytes()).decode()
css_href = re.search(r'href="\./(assets/[^"]+\.css)"', html).group(1)
js_src = re.search(r'src="\./(assets/[^"]+\.js)"', html).group(1)
css = (dist / css_href).read_text()
def font(m):
    name = m.group(1)
    p = dist / 'assets' / pathlib.Path(name).name
    mime = 'font/woff2' if name.endswith('woff2') else 'font/woff'
    return f'url(data:{mime};base64,{b64(p)})'
css = re.sub(r'url\(\.?/?(?:assets/)?([^)]+\.woff2?)\)', font, css)
js = (dist / js_src).read_text().replace('</script', '<\\/script')
models = sorted((dist / 'assets' / 'models').glob('*.glb'))
table = ','.join(f'"{p.stem}":"data:model/gltf-binary;base64,{b64(p)}"' for p in models)
html = re.sub(r'\s*<link rel="stylesheet"[^>]+>', '', html)
html = re.sub(r'\s*<script type="module"[^>]+></script>', '', html)
html = html.replace('</head>', f'<style>{css}</style>\n<script>window.__BW_MODELS={{{table}}};</script>\n</head>')
html = html.replace('</body>', f'<script type="module">{js}</script>\n</body>')
out.write_text(html)
print(out, round(out.stat().st_size / 1e6, 2), 'MB')
