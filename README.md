# Prata med platser

Webbplatsen för *Prata med platser* — ett utforskande projekt i gränslandet
mellan stadsplanering och offentlig konst, i Främre Boländerna och Ulleråker i
Uppsala.

**▶ [pratamedplatser på webben](https://skoteskote.github.io/prata-med-platser/)**
· [Instagram](https://www.instagram.com/pratamedplatser/)
· [love@loveantell.se](mailto:love@loveantell.se)

Genom en serie workshops med lokala grupper samlas de medverkandes drömmar och
visioner om en plats in. Allt som sägs och sker spelas in, fotograferas och
3D-scannas, och blir material i en växande databas. Ur den byggs geografiskt
placerade XR-verk där besökare kan föra samtal med platsen.

Gruppen: Love Antell, Jakob Skote och Rosa Danenberg.

## Sidan

En sida, tre vyer (start, `#/om`, `#/schema`), med en 3D-scanning som ligger
bakom allt innehåll. Routingen är hash-baserad eftersom sajten ligger på en
projekt-subpath på GitHub Pages, där riktiga sökvägar hade krävt
server-omskrivningar.

* **Innehållet är vanlig HTML** i `web-src/index.html` — texterna på Om- och
  Schema-sidorna redigeras direkt där.
* **Formen** styrs av `web-src/style.css`. Off-white botten, svart tusch, DM Sans.
  Slöjan över scanningen sätts av `--veil`, som är lätt på startsidan och tung
  på textsidorna.
* **Inga externa anrop.** Typsnittet är självhostat och allt är bundlat.
  Bygget failar om något i utdatan skulle ladda från en främmande värd.
* Logotyp och tuschstreck i `web-src/assets/` är utklippta ur originalteckningen
  och sparade som transparenta PNG:er.

Bygg om efter en textändring:

```sh
cd web-src && npx vite build     # skriver till ../web
```

## Scanningen

3D-scanningen är rekonstruerad ur en handhållen iPhone-film med en helt lokal
pipeline — ffmpeg, COLMAP, Brush och Spark. Inget CUDA-verktyg, inget uppladdat
till någon tjänst.

| | |
|---|---|
| Källa | 391 s handhållen film, 1080×1920, HLG/BT.2020 HDR |
| Bildrutor | 1 200 av 11 730 (skarpast per tidsfönster) |
| Registrerade av COLMAP | 918 (76,5 %), 0,91 px reprojektionsfel |
| Splats | 2 000 000, SH-grad 3 |
| Nyttolast | 29,7 MB `.sog` (15× mindre än 449 MB PLY) |

**[REPORT.md](REPORT.md)** är hela den tekniska genomgången: HDR-tonemappingen,
det skärpebaserade urvalet av bildrutor, varför COLMAP inte nådde 90 %-gränsen,
och vad en omfilmning skulle behöva göra annorlunda.

De tunga katalogerna (`input/`, `frames/`, `colmap/`, `splat/`, `tools/`) är
gitignorerade — tillsammans cirka 3,2 GB, och alla återskapningsbara:

```sh
./run.sh          # kör varje steg som inte redan är klart
./run.sh --list   # status per steg
```

## Publicering

`.github/workflows/pages.yml` publicerar `web/` till GitHub Pages vid varje push
till `main`. Sajten är cirka 36 MB — väl inom Pages gräns på 1 GB för en sajt
och 100 MiB per fil.
