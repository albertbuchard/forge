# Forge Atlas Cropper

Local-only helper for defining exact pixel crop regions on gamification atlas sheets.

## Run

```bash
npm run cropper:gamification
```

Open `http://127.0.0.1:4325/`.

## Workflow

1. Pick a theme and atlas.
2. Click **Create grid crops** to seed 10x10 item crops or 6x5 mascot crops.
3. Click a crop region, then drag it to move or drag a corner to resize.
4. Use numeric `X`, `Y`, `Width`, and `Height` fields for exact correction.
5. Click **Save to project**.
6. Run:

```bash
node --import tsx scripts/generate-gamification-assets.mjs
```

Saved crop files live under:

```text
tools/atlas-cropper/crop-regions/<theme>/<atlas>.json
```

The sprite generator uses those saved manual regions before falling back to automatic grid detection.
