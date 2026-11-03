# Metavido på sajten — förstudie

Kan de volymetriska workshop-inspelningarna (Keijiro Takahashis **Metavido**-format,
inspelade på iPhone) visas på pratamedplatser.se på samma sätt som gaussian
splat-scanningen?

**Slutsats: ja, men formatet måste avkodas av oss själva.** Det finns ingen
webbrenderare att låna. Allt nedan är verifierat mot en riktig inspelning,
`Record_0911_1716_25_av_small.mp4` (209 MB, 1920×1080, 60 fps, 10 min 11 s).

Ingenting av det här är byggt än — dokumentet är underlag för beslut.

---

## Det finns ingen webbrenderare

Keijiro har inget JS- eller TypeScript-repo för vare sig Metavido eller
föregångaren Bibcam. Hans åtta repon på området (`Metavido`, `MetavidoVFX`,
`MetavidoTimeline`, `BibcamUrp`, `BibcamStage`, `BibcamAsync`, `BibcamSketches`,
`BibcamVfxOffline`) är alla C# och Unity.

Det enda som finns är `ggm3414/MetavidoWeb` — ett **Unity WebGL-bygge** på 19 MB
wasm plus datafiler, gjort av tredje part. Det går inte att lägga bredvid
Spark-vyaren: fel storleksordning, egen renderingsloop, ingen kod att återanvända.

Vägen framåt är därför att avkoda formatet själva. Specifikationen är liten —
cirka 150 rader fördelade på `Common/Shaders/Common.hlsl`,
`Decoder/Shaders/Decoder.compute` och `Decoder/Scripts/RenderUtils.cs` i
`keijiro/Metavido`. Den är portad och verifierad i Python under den här
förstudien, och går rakt över till GLSL.

---

## Formatet

En 1920×1080-ruta som packar fyra saker:

```
+---------+---------+
|    Z    |         |   C  färg, anamorft ihoptryckt 2:1 (960×1080 för en 16:9-bild)
+---------+    C    |   Z  hue-kodat djup, 960×540
|   S/M   |         |   S  human stencil, 960×540
+---------+---------+   M  metadata-streckkod, 96×256 px i blå kanalen
```

**Djupet** ligger som nyans (hue) mellan `near` och `far`, med 1 % marginal och
1 % padding i varje ände. Avkodning är `mtvd_RGB2Hue` baklänges.

**Metadatan** är 12 flyttal per ruta, bit för bit i blå kanalen: varje tal är en
kolumn på 8 px (avläst på `x = id*8+3` och `x = id*8+5`), varje bit en rad på
8 px (`y = i*8+4`), räknat från rutans **nederkant**. Innehållet är
kameraposition (3), rotationskvaternion xyz (3 — w räknas fram som
`sqrt(1-x²-y²-z²)`), center shift (2), fov (1), djupintervall (2) och en hash.

### Verifiering

120 rutor i rad avkodade ur testfilen:

| | |
|---|---|
| Giltiga rutor | 120 av 120 |
| Kvaternionens längd | 1,0000 genomgående |
| Djupintervall | exakt 0,2–10,0 m |
| Kamerarörelse per ruta | ~3 mm vid 60 fps |

Posespåret är rent. Ingen glättning behövs.

---

## Kalibreringen i den här inspelningen stämmer inte

Inspelningen är gjord med telefonen i **porträttläge**, och det bryter mot vad
formatet antar.

Kodaren gör `proj[1,1] = proj[0,0] * 16/9` och hämtar `proj[0,0]` ur AR
Foundations **skärmprojektion**, medan bilden som lagras är kamerans
**liggande** buffert beskuren till 16:9. I porträttläge beskriver den lagrade
fov:en alltså skärmens smala axel, inte bildens.

Avkodat rakt av blir resultatet vridet 90° och ungefär hälften så stort —
personen i bild mäter 0,54 m.

**Rättningen är två konstanter för hela klippet:** en 90°-rullning kring
kamerans blickriktning, och en riktig horisontell fov. Med rullning och
hfov 68° faller allt på plats:

| | avkodat rakt av | rättat |
|---|---|---|
| Personens höjd | 0,54 m | **1,52 m** |
| Rummets höjd (golv–tak) | — | **3,61 m** |

Det är korrekt metrisk skala. Rättningen behöver göras en gång per
inspelningsuppsättning, inte per klipp.

**Att göra inför kommande workshops:** lås inspelningsappen till liggande läge.
Då stämmer metadatan med bilden och ingen fudge-faktor behövs.

---

## Storlek är den bindande begränsningen — inte kvalitet

Testfilen är 209 MB för 10 minuter. Tre saker krockar:

- GitHubs hårda gräns är **100 MB per fil**. Git LFS hjälper inte — Pages
  serverar inte LFS-filer ordentligt, och fribandbredden är 1 GB/mån.
- `scripts/stage5_web.sh` failar bygget på `<video src="https://…">`. Extern
  värd bryter mot projektets egen regel.
- **1920×1080 är obligatoriskt.** Streckkoden sitter på fasta pixelkoordinater,
  så nedskalning förstör metadatan. Bara längd och bitrate går att ändra.

Omkodning visade sig däremot vara nästan gratis. Mätt mot originalet, 20 s klipp:

| | Storlek | Metadata | Djup-RMS mot original |
|---|---|---|---|
| CRF 20 @ 60 fps | 9,6 MB | 1201/1201 giltiga | 16 mm |
| CRF 23 @ 30 fps | 6,2 MB | 602/602 giltiga | 18 mm |
| **CRF 26 @ 30 fps** | **4,5 MB** | 602/602 giltiga | 21 mm |
| CRF 30 @ 30 fps | 3,1 MB | 602/602 giltiga | 27 mm |

Högfrekvent djupbrus är 24 mm i **originalet** och oförändrat 23,5 mm vid
CRF 30 — ARKits eget djup är brusgolvet, kompressionen lägger sig under det.

Rekommendation: **CRF 26 @ 30 fps**, cirka 13,5 MB per minut. Repot är 37 MB
idag, så en handfull utdrag på 20–40 s ryms bekvämt. Hela tiominutersklipp gör
det inte, och kommer inte att göra det.

```sh
ffmpeg -ss <start> -t <längd> -i in.mp4 -an \
  -c:v libx264 -crf 26 -preset slow -r 30 -pix_fmt yuv420p \
  -movflags +faststart ut.mp4
```

---

## Föreslagen lösning

### Avkoda metadatan i byggsteget, inte i webbläsaren

Det här är det viktigaste valet. Ett byggsteg läser streckkoden ur varje ruta
och skriver en sidofil: 12 flyttal per ruta, 48 byte, alltså ~86 kB per minut.
I webbläsaren slås posen upp på `mediaTime` från `requestVideoFrameCallback`.

Vinsten är tre saker på en gång: ingen GPU→CPU-återläsning per ruta, ingen risk
att webbläsarens färghantering stör bitavläsningen, och rullnings- och
fov-rättningen blir en sak som sker vid bygget i stället för en fudge i runtime.

### Renderaren

Ett `THREE.Points`-rutnät (960×540, halva det på mobil) där vertex-shadern
samplar djupkvadranten, projicerar ut med posen från sidofilen och hämtar färg
ur högra halvan. En shader, inga nya beroenden — three.js är redan buntat.

Observera att Metavido är Unitys **vänsterhänta** koordinatsystem och three.js
är högerhänt. En handedness-konvertering krävs.

### Egen sida, `/video/`

Som `/map/` är idag: en tredje Vite-ingång. Den behöver three.js men inte Spark,
och ska aldrig dra in den 30 MB stora splatten.

### Lägg inte ihop det med splatten än

Metavido-klippet ligger i ARKits metriska rum, splatten i COLMAPs godtyckliga
skala. Att lägga dem på varandra kräver en handjusterad transform — och
scanningen på sajten är fortfarande lagerlokalstestet, inte Boländerna eller
Ulleråker. Att passa in mot en platshållare är bortkastat arbete. Bygg den
volymetriska vyaren fristående, och gör inpassningen när det finns en riktig
platsscanning.

### Möjlig fortsättning

Bläckpenseln är samma 3D-stämpling som i vyaren, så det går att måla på den
volymetriska videon också. Inte del av första bygget.

---

## Referenser

- `keijiro/Metavido` — formatet, kodaren och Unity-avkodaren
- `keijiro/MetavidoVFX` — VFX Graph-exempel, samma rekonstruktionsmatematik
- `ggm3414/MetavidoWeb` — Unity WebGL-bygge, inte användbart här
