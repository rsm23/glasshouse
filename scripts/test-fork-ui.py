#!/usr/bin/env python3
"""Mutation checks for the fork appearance merge guard (no TV or network)."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('guard', ROOT / 'scripts/check-fork-ui.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class AppearanceGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        files = set(guard.ANCHORS) | set(guard.STYLES) | {guard.MANIFEST, 'server/deploy.sh', 'server/assets/ui.html', 'server/assets/dashboard.html', 'scripts/check-fork-ui.py',
            'scripts/merge-preserving-ui.py', 'scripts/test-fork-ui.py'}
        files |= {'server/assets/' + style for style in guard.STYLES.values()}
        for relative in files:
            relative = relative.split('#')[0]
            dest = self.root / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, dest)

    def replace(self, relative, before, after):
        file = self.root / relative
        file.write_text(file.read_text().replace(before, after))

    def test_current_tree(self):
        self.assertEqual(guard.problems(self.root), [])

    def test_upstream_can_change_base_style(self):
        self.replace('server/assets/home.html', '.tile{', '.tile{font-weight:500;')
        self.assertEqual(guard.problems(self.root), [])

    def test_missing_and_overwritten_styles_fail(self):
        file = self.root / 'server/assets/home-liquid-glass.css'
        file.write_text('body{color:red}')
        self.assertTrue(any('changed' in error for error in guard.problems(self.root)))
        file.unlink()
        self.assertTrue(any('missing server/assets/home-liquid-glass.css' in error for error in guard.problems(self.root)))

    def test_removed_loading_hook_fails(self):
        self.replace('server/assets/home.html', 'home-liquid-glass.css', 'official.css')
        self.assertTrue(any('stylesheet' in error for error in guard.problems(self.root)))

    def test_dashboard_cannot_adopt_home_theme(self):
        self.replace('server/assets/ui.html', '</head>', '<link rel="stylesheet" href="/assets/home-liquid-glass.css"></head>')
        self.assertTrue(any('limited to Glasshouse Home' in error for error in guard.problems(self.root)))

    def test_base_style_loaded_after_fork_fails(self):
        self.replace('server/assets/home.html', '</head>', '<style>body{background:red}</style></head>')
        self.assertTrue(any('after the base styles' in error for error in guard.problems(self.root)))

    def test_removed_deploy_asset_fails(self):
        self.replace('server/deploy.sh', 'assets/home-liquid-glass.css', '')
        self.assertTrue(any('does not ship' in error for error in guard.problems(self.root)))

    def test_selector_rename_fails(self):
        self.replace('server/assets/home.html', 'id="widgets"', 'id="new-widgets"')
        self.assertTrue(any('contract lost' in error for error in guard.problems(self.root)))

    def test_removed_ci_check_fails(self):
        self.replace('.github/workflows/checks.yml', 'python3 scripts/check-fork-ui.py', 'true')
        self.assertTrue(any('contract lost' in error for error in guard.problems(self.root)))

    def merge_repo(self, remove_hook=False):
        def git(*args):
            return subprocess.check_output(['git'] + list(args), cwd=self.root, text=True, stderr=subprocess.DEVNULL).strip()
        git('init', '-b', 'codex/theme')
        git('config', 'user.name', 'Fixture')
        git('config', 'user.email', 'fixture@example.invalid')
        git('add', '.')
        git('commit', '-qm', 'Fixture base')
        original = git('rev-parse', 'HEAD')
        git('checkout', '-qb', 'official')
        if remove_hook:
            self.replace('server/assets/home.html', 'home-liquid-glass.css', 'official.css')
        else:
            (self.root / 'official-change.txt').write_text('upstream addition\n')
        git('add', '.')
        git('commit', '-qm', 'Official update')
        git('checkout', 'codex/theme')
        result = subprocess.run(['python3', 'scripts/merge-preserving-ui.py', 'official'],
                                cwd=self.root, capture_output=True, text=True)
        self.assertEqual(git('rev-parse', 'HEAD'), original, 'merge wrapper must never commit')
        self.assertTrue((self.root / '.git/MERGE_HEAD').exists(), 'result stays reviewable')
        return result

    def test_real_merge_preserves_styles_and_stays_uncommitted(self):
        result = self.merge_repo()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(guard.problems(self.root), [])

    def test_real_merge_detects_removed_hook_before_commit(self):
        result = self.merge_repo(remove_hook=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stylesheet', result.stderr)


if __name__ == '__main__':
    unittest.main()
