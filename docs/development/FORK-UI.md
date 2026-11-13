# Fork appearance and upstream merges

This fork uses a tvOS-inspired Liquid Glass appearance only for Glasshouse
Home on the TV: its app and input tiles, widgets and widget detail panels.
It adapts [Apple's guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
to webOS HTML/CSS. The web dashboard and TV settings dashboard keep upstream's
appearance.

Home keeps the existing text and accent colours, including saved custom choices.
Shaded translucent surfaces and highlights identify focus. TV text keeps the
bundled Manrope font for stable metrics and offline use. Existing 360 × 200
widget slots and both Home layouts remain the layout contract. Reduced-motion
and reduced-transparency preferences have CSS fallbacks. Older engines render
shaded materials without blur. The design dials are Energy 2, Rhythm 2, Motion 1:
a quiet screen read from the sofa, with focus carrying the emphasis.

The appearance lives in `server/assets/home-liquid-glass.css`. Keep it separate
from upstream styles. The server includes it inside Home's existing recolourable
stylesheet before its script reads it; keep that route hook and Home's stylesheet
link when resolving upstream changes. The deploy list and packages ship the file.

## Merge an official update

Commit or stash existing work on the fork feature branch, fetch the intended
remote, then run:

```sh
git fetch upstream
python3 scripts/merge-preserving-ui.py upstream/main
scripts/check-all.sh
```

The helper refuses main and detached HEAD, requires a clean checkout, checks
the appearance before and after merging, and leaves the merge uncommitted for
review. It also compares protected file bytes against their pre-merge contents.
A conflict or failed appearance check leaves the merge in place to resolve;
`git merge --abort` cancels it. Commit only after reviewing the result and checks.
Push the feature branch to its existing PR; merging the PR remains the maintainer's call.

`python3 scripts/check-fork-ui.py` verifies stylesheet hashes, loading order,
key upstream selectors, server inlining, deployment and CI hooks. It runs in
`check-all.sh` and CI. Intentional theme edits require review, followed by
`python3 scripts/check-fork-ui.py --record` to update the tracked hash manifest.
Never record a new baseline just to clear a failed upstream merge.

The checks catch missing integration and known selector changes, but cannot
prove visual compatibility with every upstream CSS change. Review browser
screenshots and test on a real TV after merging. Ordinary `git merge` does not
run the helper; bypassing it, deleting the checks, or installing an official
release over the fork can replace this appearance. Deploy from the fork's branch.
