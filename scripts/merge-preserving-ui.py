#!/usr/bin/env python3
"""Merge an existing upstream ref, leaving the checked result staged for review."""
import importlib.util
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('fork_ui', ROOT / 'scripts/check-fork-ui.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def git(*args):
    return subprocess.check_output(['git'] + list(args), cwd=ROOT, text=True).strip()


def main():
    if len(sys.argv) != 2 or sys.argv[1].startswith('-'):
        sys.exit('usage: python3 scripts/merge-preserving-ui.py upstream/main')
    if git('branch', '--show-current') in ('', 'main', 'master'):
        sys.exit('Use a fork feature branch before merging.')
    if git('status', '--porcelain') or (ROOT / git('rev-parse', '--git-path', 'MERGE_HEAD')).exists():
        sys.exit('Commit or stash existing work and finish the current merge first.')
    errors = guard.problems(ROOT)
    if errors:
        sys.exit('\n'.join(errors))
    protected = list(guard.STYLES.values())
    protected = ['server/assets/' + style for style in protected] + [
        guard.MANIFEST, 'scripts/check-fork-ui.py', 'scripts/merge-preserving-ui.py',
        'scripts/test-fork-ui.py']
    before = {relative: (ROOT / relative).read_bytes() for relative in protected}
    result = subprocess.run(['git', 'merge', '--no-commit', '--no-ff', sys.argv[1]], cwd=ROOT)
    if result.returncode:
        sys.exit('Merge needs conflict resolution. Keep the fork styles; run scripts/check-fork-ui.py before committing. git merge --abort cancels this merge.')
    errors = guard.problems(ROOT)
    for relative, content in before.items():
        if not (ROOT / relative).is_file() or (ROOT / relative).read_bytes() != content:
            errors.append('protected fork file changed: ' + relative)
    if errors:
        sys.exit('\n'.join(errors) + '\nMerge left uncommitted. Resolve these changes or use git merge --abort.')
    print('Fork UI preserved. Review the staged merge and run scripts/check-all.sh before committing.')


if __name__ == '__main__':
    main()
