# Fretboard Words PWA

A static, installable guitar fretboard trainer. Sessions and analysis history stay in this browser on this device. Export data regularly; use Import data to move a backup to another browser or device.

## GitHub Pages

Put the contents of this folder at the root of a GitHub repository. In repository **Settings → Pages**, select **Deploy from a branch**, choose the main branch and **/(root)**, then save. The resulting `https://<username>.github.io/<repository>/` URL supports installation and offline use after its first successful load.

All app asset links and the service worker scope are relative, so a GitHub Pages repository path works without editing the files. `.nojekyll` keeps Pages from processing the static files through Jekyll.

## iPhone

Open the GitHub Pages URL in Safari. Tap Share → Add to Home Screen, enable **Open as Web App** if shown, then tap Add. Open it once while online so the app files can be cached for offline practice.

## Random practice

The random deck uses a shuffled bag of all playable selected notes. Every note occurs once before any note repeats; available strings rotate through their own shuffled bag for each note. Named familiar shapes also rotate through every eligible shape before repeating. The note order within a named shape stays fixed to preserve that shape.
