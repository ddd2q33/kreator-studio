# Plantillas JSON para el Video Editor

Cada archivo es un **scene file**: describe la línea de tiempo completa que el
Video Studio importa con el botón **JSON** del inspector (también sirve
arrastrar el `.json` a la ventana del editor).

## Formato

```json
{
  "version": 1,
  "brand": "#0d9488",
  "portrait": true,
  "scenes": [ { ...escena }, { ...escena } ]
}
```

También se acepta un array suelto: `[ { "title": "…" } ]`.

### Campos del documento

| Campo      | Tipo    | Default      | Notas |
|------------|---------|--------------|-------|
| `version`  | number  | `1`          | Si el archivo es de una versión futura, se avisa y se importa igual. |
| `brand`    | string  | `#0d9488`    | Color de acento; debe ser hex (`#rgb` o `#rrggbb`). |
| `portrait` | boolean | `false`      | `true` = vertical 9:16 (Reels/TikTok/Shorts). |
| `scenes`   | array   | — (obligatorio) | Al menos una escena con `title`. |

### Campos de cada escena

Solo `title` es obligatorio — todo lo demás tiene default, así que el archivo
más pequeño posible es `{"scenes":[{"title":"Hola"}]}` (véase
`minimal-one-scene.json`).

| Campo        | Tipo   | Default              | Notas |
|--------------|--------|----------------------|-------|
| `title`      | string | — (obligatorio)      | Titular grande del frame. Sin title la escena se descarta con aviso. |
| `kicker`     | string | `SCENE 01`, `02`…    | Etiqueta pequeña sobre el título. |
| `subtitle`   | string | `""`                 | Línea de apoyo bajo el título. |
| `narration`  | string | `""`                 | Texto para TTS (máx. 5000 caracteres). Vacío = escena muda. |
| `imageKey`   | string \| null | `null`       | **Nombre del archivo** tal cual está en el mapa de imágenes del editor (minúsculas, p. ej. `"cover.jpg"`). Si no existe en el mapa, se limpia con aviso. |
| `duration`   | number | `4`                  | Segundos; se recorta al rango 1–20. Acepta `"4.5"` como string. |
| `transition` | string | `"fade"`             | `cut` \| `fade` \| `zoom` \| `pan`. Un valor desconocido cae a `fade`. |
| `chapterId`  | string \| null | `null`       | Enlace opcional al capítulo del libro activo (para "From book"). Se avisa si no coincide. |
| `voice`      | object | voz por defecto      | Config ElevenLabs; ver abajo. |

### `voice` (opcional)

```json
{ "voiceId": "21m00Tcm4TlvDq8ikWAM", "modelId": "eleven_multilingual_v2", "stability": 0.5, "similarity": 0.75, "style": 0.3 }
```

- `stability` / `similarity` / `style`: números 0–1; se recortan al rango.
- `modelId` válidos: `eleven_multilingual_v2`, `eleven_flash_v2_5` (rápido),
  `eleven_turbo_v2_5`.
- Voces incluidas de fábrica: `21m00Tcm4TlvDq8ikWAM` (Rachel),
  `pNInz6obpgDQGcFmaJgB` (Adam, audiolibro), `EXAVITQu4vr4xnSDxMaL` (Bella),
  `ErXwobaYiN019PkySvjV` (Antoni), `VR6AewLTigWG4xSOukaG` (Arnold, grave)…

## Plantillas incluidas

| Archivo                    | Qué es |
|----------------------------|--------|
| `book-promo-es.json`       | Promo de 3 escenas en español, vertical (hook → problema → promesa). |
| `chapter-promos.json`      | Una escena por capítulo + CTA, horizontal, voz de audiolibro. |
| `minimal-one-scene.json`   | El mínimo absoluto: solo `title`. Punto de partida para generar. |

## Cómo importarlas

1. Abre **Video Editor** (`/video-editor`).
2. Inspector → botón **JSON** → elige el archivo (o arrástralo a la ventana).
3. El estudio repara lo que pueda (durations fuera de rango, transiciones
   desconocidas, imágenes inexistentes…) y te dice qué corrigió.

## Para generarlas con IA

Dale a tu modelo este contrato y pide "un JSON válido con N escenas":

```
{ "version": 1, "brand": "#rrggbb", "portrait": true|false, "scenes": [
  { "title": string (obligatorio), "kicker"?: string, "subtitle"?: string,
    "narration"?: string (<5000 chars), "imageKey"?: string|null,
    "duration"?: 1-20, "transition"?: "cut"|"fade"|"zoom"|"pan",
    "chapterId"?: string|null, "voice"?: { "voiceId"?: string, "modelId"?: string,
    "stability"?: 0-1, "similarity"?: 0-1, "style"?: 0-1 } } ] }
```

Los ids de escena los genera el importador; no hace falta incluirlos.
El parser vive en `lib/scene-schema.ts` (`normalizeSceneDocument`), con tests
en `tests/scene-schema.test.ts`.
