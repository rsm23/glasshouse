#!/usr/bin/env python3
"""Fail when the fork's appearance or its loading/deployment hooks are lost."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = 'scripts/fork-ui-manifest.json'
STYLES = {
    'server/assets/home.html': 'home-liquid-glass.css',
}
# These are upstream's selectors that the isolated styles need to keep matching.
ANCHORS = {
    'server/assets/home.html': ['id="widgets"', 'id="when"', 'id="rows"', 'id="rail"'],
    'server/assets/home.html#styles': ['.tile.focus', '.widget-rich', '.widget-panel'],
    'server/lib/routes.js': ["assetPath('home-liquid-glass.css')", "replace('</style>'"],
    'scripts/check-all.sh': ['python3 scripts/check-fork-ui.py', 'python3 scripts/test-fork-ui.py'],
    '.github/workflows/checks.yml': ['python3 scripts/check-fork-ui.py', 'python3 scripts/test-fork-ui.py'],
}


def problems(root=ROOT):
    errors = []

    def read(relative):
        file = root / relative.split('#')[0]
        if not file.is_file():
            errors.append('missing ' + str(file.relative_to(root)))
            return ''
        return file.read_text(encoding='utf-8')

    try:
        hashes = json.loads(read(MANIFEST))['sha256']
    except (ValueError, KeyError, TypeError):
        return errors + ['invalid fork UI manifest']
    expected = {'server/assets/' + style for style in STYLES.values()}
    if set(hashes) != expected:
        errors.append('manifest must cover the Home Liquid Glass style')
    for relative in sorted(expected):
        file = root / relative
        if not file.is_file():
            errors.append('missing ' + relative)
        elif hashlib.sha256(file.read_bytes()).hexdigest() != hashes.get(relative):
            errors.append(relative + ' changed; review before explicitly recording a new baseline')
    deploy = read('server/deploy.sh')
    for page, style in STYLES.items():
        source = read(page)
        hook = '<link rel="stylesheet" href="/assets/' + style + '">'
        if source.count(hook) != 1:
            errors.append(page + ': missing or duplicated Liquid Glass stylesheet')
        elif source.index(hook) < max(source.rfind('</style>'), source.rfind('href="/assets/ui/ui.css"')):
            errors.append(page + ': Liquid Glass must load after the base styles')
        if 'assets/' + style not in deploy.split():
            errors.append('deploy.sh does not ship ' + style)
    for page in ('server/assets/ui.html', 'server/assets/dashboard.html'):
        if 'liquid-glass.css' in read(page):
            errors.append(page + ': Liquid Glass must stay limited to Glasshouse Home')
    for relative, anchors in ANCHORS.items():
        source = read(relative)
        for anchor in anchors:
            if anchor not in source:
                errors.append(relative + ': appearance contract lost ' + anchor)
    return errors


def main():
    if sys.argv[1:] == ['--record']:
        hashes = {('server/assets/' + style): hashlib.sha256(
            (ROOT / 'server/assets' / style).read_bytes()).hexdigest()
            for style in STYLES.values()}
        (ROOT / MANIFEST).write_text(json.dumps({'sha256': hashes}, indent=2) + '\n')
    elif sys.argv[1:]:
        sys.exit('usage: scripts/check-fork-ui.py [--record]')
    errors = problems()
    if errors:
        sys.exit('\n'.join('fork-ui: ' + error for error in errors))
    print('fork-ui: styles, loading hooks, selectors, deployment and CI intact')


if __name__ == '__main__':
    main()
