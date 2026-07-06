# Character Images

Illustrated mascot characters used throughout the site. All hosted on imgbb.

| Image | URL | Description |
|---|---|---|
| `cat-character-cleaning-cat-tree` | `https://i.ibb.co/C5W7dZ5x/transp-cat-character-cleaning-cat-tree.png` | Cat character scrubbing a cat tree — used on Cat Tree Cleaning service cards and pages |
| `cat-character-cleaning-litter-box` | `https://i.ibb.co/B5YqDzzq/transp-cat-character-cleaning-litter-box.png` | Cat character scooping a litter box — used on Kitty Litter Exchange service cards and pages |
| `dog-character-cleaning-turf` | `https://i.ibb.co/RGgsxDnk/dog-character-cleaning-turf.png` | Dog character sweeping/cleaning artificial turf — used on Artificial Turf Deodorizing and Weekly Turf Maintenance service cards |
| `dog-character-deep-cleaning-yard` | `https://i.ibb.co/zWZhCpgj/dog-character-deep-cleaning-yard.png` | Dog character doing a deep yard clean — used on Yard Deep Clean service cards and pages |
| `dog-character-mowing-grass` | `https://i.ibb.co/prvTXTXd/transp-dog-character-mowing-grass.png` | Dog character mowing grass — used on Weekly Yard Maintenance service cards and pages |
| `dog-character-pressure-washing-driveway` | `https://i.ibb.co/TBkDkRfC/transp-dog-character-pressure-washing-driveway.png` | Dog character pressure washing a driveway (transparent) — used on Pressure Washing service cards and featured section |
| `dog-character-trimming-hedge` | `https://i.ibb.co/FLfX09KP/dog-character-trimming-hedge.png` | Dog character trimming a hedge with shears — used on Weekly Yard Maintenance and landscaping sections |

## Usage Notes

- Use `object-contain` and `drop-shadow-md` for all character images (they have transparent backgrounds)
- Desktop mascot pattern (from Services.tsx): `absolute -top-28 -right-10 w-52 h-52 object-contain drop-shadow-md pointer-events-none select-none hidden min-[640px]:block`
- Mobile mascot pattern: `flex justify-center mb-3 min-[640px]:hidden` wrapping `h-36 w-auto object-contain drop-shadow-md`
- On standalone service/feature sections (not cards), display inline at `w-40 h-40` or `w-48 h-48` with `object-contain`
