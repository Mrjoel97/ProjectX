"use node";

import { sha256Bytes } from "@pikar/core/webRuntime";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

type Image = { bytes: Uint8Array; mimeType: string };
export const VISION_IMAGE_BYTE_LIMIT = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8_000_000;
const MAX_SOURCE_PIXELS = 20_000_000;
const MAX_EDGE = 16384;

function pngDimensions(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw Error("PRESENCE_REFERENCE_IMAGE_INVALID");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    width * height > MAX_SOURCE_PIXELS
  )
    throw Error("PRESENCE_REFERENCE_DIMENSIONS_INVALID");
  // A single still must describe the entire reference. Never silently discard animation frames.
  for (let offset = 8; offset < bytes.length; ) {
    if (offset + 12 > bytes.length) throw Error("PRESENCE_REFERENCE_IMAGE_INVALID");
    const length = bytes.readUInt32BE(offset),
      tag = bytes.toString("ascii", offset + 4, offset + 8);
    if (tag === "acTL" || length > bytes.length - offset - 12)
      throw Error("PRESENCE_REFERENCE_IMAGE_INVALID");
    offset += length + 12;
    if (tag === "IEND" && offset !== bytes.length) throw Error("PRESENCE_REFERENCE_IMAGE_INVALID");
  }
}

/** Derive the model input from the exact receipt-owned blob. No caller can supply a thumbnail. */
export function prepareStitchVisionImage(original: Image) {
  if (original.bytes.length > MAX_SOURCE_BYTES) throw Error("PRESENCE_REFERENCE_UNAVAILABLE");
  if (original.bytes.length <= VISION_IMAGE_BYTE_LIMIT) return { image: original };
  const source = Buffer.from(
    original.bytes.buffer,
    original.bytes.byteOffset,
    original.bytes.byteLength,
  );
  let decoded: { width: number; height: number; data: Uint8Array };
  if (original.mimeType === "image/png") {
    pngDimensions(source);
    decoded = PNG.sync.read(source, { checkCRC: true });
  } else if (
    original.mimeType === "image/jpeg" &&
    source[0] === 255 &&
    source[1] === 216 &&
    source[2] === 255
  ) {
    decoded = jpeg.decode(source, {
      useTArray: true,
      maxResolutionInMP: MAX_SOURCE_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 256,
      tolerantDecoding: false,
    });
  } else throw Error("PRESENCE_REFERENCE_IMAGE_INVALID");
  if (
    !decoded.width ||
    !decoded.height ||
    decoded.width > MAX_EDGE ||
    decoded.height > MAX_EDGE ||
    decoded.width * decoded.height > MAX_SOURCE_PIXELS ||
    decoded.data.length !== decoded.width * decoded.height * 4
  )
    throw Error("PRESENCE_REFERENCE_DIMENSIONS_INVALID");
  const scale = Math.min(
    1,
    1440 / decoded.width,
    4096 / decoded.height,
    Math.sqrt(3_500_000 / (decoded.width * decoded.height)),
  );
  const width = Math.max(1, Math.round(decoded.width * scale)),
    height = Math.max(1, Math.round(decoded.height * scale));
  const pixels = Buffer.alloc(width * height * 4);
  // Area average preserves narrow text strokes during downsampling. Composite alpha on white.
  for (let y = 0; y < height; y++) {
    const top = Math.floor((y * decoded.height) / height),
      bottom = Math.floor(((y + 1) * decoded.height) / height);
    for (let x = 0; x < width; x++) {
      const left = Math.floor((x * decoded.width) / width),
        right = Math.floor(((x + 1) * decoded.width) / width);
      let red = 0,
        green = 0,
        blue = 0;
      for (let sy = top; sy < bottom; sy++)
        for (let sx = left; sx < right; sx++) {
          const i = (sy * decoded.width + sx) * 4,
            alpha = decoded.data[i + 3]! / 255,
            matte = 255 * (1 - alpha);
          red += decoded.data[i]! * alpha + matte;
          green += decoded.data[i + 1]! * alpha + matte;
          blue += decoded.data[i + 2]! * alpha + matte;
        }
      const count = (right - left) * (bottom - top),
        i = (y * width + x) * 4;
      pixels[i] = Math.round(red / count);
      pixels[i + 1] = Math.round(green / count);
      pixels[i + 2] = Math.round(blue / count);
      pixels[i + 3] = 255;
    }
  }
  const bytes = new Uint8Array(jpeg.encode({ width, height, data: pixels }, 82).data);
  if (!bytes.length || bytes.length > VISION_IMAGE_BYTE_LIMIT)
    throw Error("PRESENCE_VISION_IMAGE_LIMIT");
  const derivation = {
    transform: "area-white-jpeg82-v1" as const,
    originalHash: sha256Bytes(original.bytes),
    originalWidth: decoded.width,
    originalHeight: decoded.height,
    imageHash: sha256Bytes(bytes),
    width,
    height,
  };
  return { image: { bytes, mimeType: "image/jpeg" }, derivation };
}
