# 🕊️ trauma-book-template

Plantilla editorial para **workbooks terapéuticos premium** — trauma, recuperación emocional, regulación del sistema nervioso, apego, duelo y desarrollo personal.

Flujo: **Markdown → HTML + CSS → PDF profesional 6×9 (Amazon KDP)**.

El diseño busca transmitir seguridad, calma y acompañamiento: tipografía serif cálida, paleta apagada apta para B/N, mucho espacio en blanco y componentes terapéuticos coherentes.

---

## Quickstart

```bash
cd trauma-book-template

# 1. Edita manuscript/book.md (directivas ::: + Markdown)

# 2. Compila el libro
node build.mjs          # → html/book.html (print) + html/preview.html (pantalla)

# 3. Exporta el PDF
node to-pdf.mjs         # → output/final-book.pdf (6×9in)

# Modo continuo (rebuild automático)
node watch.mjs
```

Requisitos: Node 18+, Chrome/Chromium instalado (para el PDF). `npm i -D chrome-remote-interface` para el exportador.

---

## Estructura

```
trauma-book-template/
├── manuscript/
│   └── book.md        ← TODO tu contenido vive aquí
├── css/
│   ├── main.css       ← design system: paleta, tipografía, portada, front/back matter
│   ├── workbook.css   ← componentes: tools, cajas, worksheets, diagramas, tablas
│   └── print.css      ← KDP 6×9: @page, márgenes espejados, saltos, B/N-safe
├── html/              ← generado (book.html print + preview.html pantalla)
├── images/            ← ilustraciones y diagramas (referenciados por ::: figure)
├── fonts/             ← opcional: fuentes locales (si no usas Google Fonts)
├── output/            ← final-book.pdf
├── build.mjs          ← procesador Markdown + directivas
├── to-pdf.mjs         ← exportador PDF (Chrome headless)
└── watch.mjs          ← rebuild en caliente
```

---

## Sintaxis de directivas

```md
::: name attr="value"       ← abre bloque
...contenido markdown...
:::                         ← cierra el bloque más interno
```

Los bloques se pueden **anidar** (p. ej. un worksheet dentro de un tool).

### Referencia

| Directiva | Uso |
|---|---|
| `::: titlepage title subtitle author publisher kicker` | Portada interna (self-closing con `:::` final) |
| `::: copyright` | Página de copyright |
| `::: disclaimer` | Aviso (education-not-therapy) |
| `::: dedication` | Dedicatoria centrada |
| `::: page heading=".."` | Página arbitraria (How to Use, About the Author…) |
| `::: chapter number=1 title=".." intro=".." quote=".."` | Apertura de capítulo (página nueva, kicker + título + intro + frase) |
| `::: tool number=01 title=".."` | Herramienta numerada. Secciones: `**Purpose:**`, `**Why This Matters:**`, `**How To Use:**`, `**Reflection Questions:**`, `**Practice:**`, `**Journal Space:**` |
| `::: box insight` / `science` / `reflection` / `therapist` / `important` | Cajas (azul / morada / beige / verde / ámbar). Alias: `::: box-science`, `::: box-insight`… |
| `::: worksheet title=".." purpose=".."` | Worksheet con bordes y líneas de escritura |
| `::: reflection title=".." before=".."` | Ejercicio de reflexión |
| `::: summary` | Chapter Summary (What You Learned / Key Takeaways / Practice For This Week como `####`) |
| `::: quote by=".."` | Frase destacada centrada (QUOTE) |
| `::: diagram caption=".." highlight=".."` | Diagrama vertical; nodos = líneas, flechas = `↓` |
| `::: figure src="images/.." caption=".."` | Imagen centrada con caption |
| `::: table caption=".." columns="A\|B\|C"` + filas `a \| b \| c` | Tabla suave con caption |
| `::: resources heading="Resources"` | Página de recursos con lista → |

### Markdown soportado

`**bold**` · `*italic*` · `` `code` `` · `[link](url)` · `==highlight==` · listas `-` / `1.` · `##`–`####` · tablas pipe · líneas de escritura con `___` (3+ guiones bajos solos en una línea) o un run largo de guiones (`----` y más) · `---` exacto (3 guiones) como separador de sección.

---

## Sistema de diseño

- **Texto:** Lora (serif cálida, 10.5pt impreso) · **Títulos/etiquetas:** Inter
- **Paleta** (todas supervivientes a B/N por contraste + borde):
  `--accent` azul pizarra (estructura) · azul suave (Insight) · morado (Science) · beige (Reflection) · verde (Therapist Note) · ámbar (Important)
- **Ritmo:** interlineado 1.62, párrafos justificados con guionado automático del navegador, `orphans/widows` controlados.
- **Apertura de capítulo:** regla → kicker espaciado → título grande → intro emocional → frase de reflexión. Página nueva siempre.

### Impresión (print.css)

- `@page { size: 6in 9in }`, márgenes espejados: interior 0.75″, exterior 0.5″, superior/inferior 0.6″+
- Capítulos y front matter siempre página impar (recto) vía `break-before: page`
- Cajas/worksheet no se parten entre páginas; las tools largas fluyen pero las secciones no se separan de su etiqueta
- Backgrounds impresión-seguros (grises cálidos, sin saturación)

---

## Exportar PDF (KDP)

```bash
npm i -D chrome-remote-interface
node to-pdf.mjs
```

Usa tu Chrome instalado en modo headless (`--print-to-pdf` vía DevTools) con `preferCSSPageSize: true`, de modo que el `@page 6in 9in` del CSS manda. Alternativa con calidad tipográfica superior para interiores B/N: abrir `html/book.html` en Chrome → Imprimir → Guardar como PDF → tamaño 6×9, sin encabezados, márgenes "None".

---

## Checklist Amazon KDP

- [ ] Interior exportado a PDF con `@page 6in 9in` y fuentes **embebidas**
- [ ] Sangrado 0″ (no hace falta si no hay imágenes al borde); márgenes según nº de páginas (0.75″ gutter ✓ hasta 300 p.)
- [ ] Sin números de página en portada/copyright (la plantilla los omite al forzar página nueva)
- [ ] Todas las imágenes a 300 dpi y en escala de grises si la edición es B/N
- [ ] Revisar PDF con *Two Page View* en zoom 100 %: ríos, viudas, cajas partidas
- [ ] Titulo/ISBN/copyright coinciden con la metadata de KDP
- [ ] Exportar también la portada aparte (no va dentro del interior)

---

*"Este libro fue creado para acompañarme en mi proceso de recuperación."*
