/**
 * Dependency-free PNG/JPEG dimension parsing from data URLs.
 *
 * Used by the DOCX export engine when there is no DOM available (headless API
 * routes, the book-author CLI): the browser path rasterizes images through
 * canvas and reads naturalWidth/naturalHeight, but plain Node has no image
 * stack — so we read the dimensions straight from the bytes.
 */

export type ImageSize = { width: number; height: number } | null;

export function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma);
  if (!/^data:[^;]+;base64$/i.test(meta)) return null;
  try {
    return Buffer.from(dataUrl.slice(comma + 1), "base64");
  } catch {
    return null;
  }
}

function pngSize(buf: Buffer): ImageSize {
  if (buf.length < 24) return null;
  // 8-byte signature + 4-byte length + "IHDR"
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function jpegSize(buf: Buffer): ImageSize {
  // JPEGs are marker-delimited; walk segments until we hit a SOFn marker.
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry dimensions.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }
    const length = buf.readUInt16BE(offset + 2);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function imageSizeFromDataUrl(dataUrl: string): ImageSize {
  const buf = dataUrlToBuffer(dataUrl);
  if (!buf) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return pngSize(buf);
  }
  // JPEG: FF D8 FF
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return jpegSize(buf);
  }
  return null;
}
