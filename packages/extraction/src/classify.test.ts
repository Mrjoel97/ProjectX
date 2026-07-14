import { describe, expect, it } from "vitest";
import { classify } from "./classify";

// Tiny helper: build a Uint8Array from a mix of hex byte literals and ASCII strings.
function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

const GENERIC = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

describe("classify — image", () => {
  it("PNG magic bytes -> image", () => {
    const b = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
    expect(classify(b, "", "photo.png").kind).toBe("image");
  });

  it("JPEG magic bytes -> image", () => {
    const b = bytes([0xff, 0xd8, 0xff, 0xe0]);
    expect(classify(b, "", "photo.jpg").kind).toBe("image");
  });

  it("GIF magic bytes -> image", () => {
    const b = bytes("GIF89a");
    expect(classify(b, "", "anim.gif").kind).toBe("image");
  });

  it("WEBP (RIFF....WEBP) magic bytes -> image", () => {
    const b = bytes("RIFF", [0x00, 0x00, 0x00, 0x00], "WEBP");
    expect(classify(b, "", "pic.webp").kind).toBe("image");
  });

  it("mime image/* fallback when bytes are not a known image magic (e.g. SVG)", () => {
    const b = bytes("<svg></svg>");
    expect(classify(b, "image/svg+xml", "icon.svg").kind).toBe("image");
  });
});

describe("classify — pdf", () => {
  it("%PDF magic bytes -> pdf", () => {
    const b = bytes("%PDF-1.7\n");
    expect(classify(b, "", "report.pdf").kind).toBe("pdf");
  });

  it("mime application/pdf -> pdf even with generic bytes", () => {
    expect(classify(GENERIC, "application/pdf", "report").kind).toBe("pdf");
  });
});

describe("classify — audio", () => {
  it("WAV (RIFF....WAVE) magic bytes -> audio", () => {
    const b = bytes("RIFF", [0x00, 0x00, 0x00, 0x00], "WAVE");
    expect(classify(b, "", "clip.wav").kind).toBe("audio");
  });

  it("mp3 ID3 magic bytes -> audio", () => {
    const b = bytes("ID3", [0x03, 0x00]);
    expect(classify(b, "", "song.mp3").kind).toBe("audio");
  });

  it("mp3 \\xFF\\xFB frame sync -> audio", () => {
    const b = bytes([0xff, 0xfb, 0x90, 0x00]);
    expect(classify(b, "", "song.mp3").kind).toBe("audio");
  });

  it("Ogg (OggS) magic bytes -> audio", () => {
    const b = bytes("OggS", [0x00, 0x02]);
    expect(classify(b, "", "clip.ogg").kind).toBe("audio");
  });

  it("m4a (ftyp box) magic bytes -> audio", () => {
    const b = bytes([0x00, 0x00, 0x00, 0x18], "ftypM4A ");
    expect(classify(b, "", "clip.m4a").kind).toBe("audio");
  });

  it("webm/matroska (MediaRecorder default) magic bytes -> audio — INTK-03 dictation contract", () => {
    const b = bytes([0x1a, 0x45, 0xdf, 0xa3], [0x01, 0x02, 0x03]);
    const result = classify(b, "audio/webm;codecs=opus", "dictation.webm");
    expect(result.kind).toBe("audio");
  });

  it("webm/matroska magic bytes alone (no mime) still -> audio", () => {
    const b = bytes([0x1a, 0x45, 0xdf, 0xa3]);
    expect(classify(b, "", "blob").kind).toBe("audio");
  });

  it("mime audio/* fallback when bytes are not a known audio magic", () => {
    expect(classify(GENERIC, "audio/x-custom-codec", "clip.xyz").kind).toBe("audio");
  });
});

describe("classify — document", () => {
  it("mime text/plain -> document", () => {
    const b = bytes("hello world");
    expect(classify(b, "text/plain", "notes").kind).toBe("document");
  });

  it(".txt extension fallback (mime absent, bytes unrecognized) -> document", () => {
    expect(classify(GENERIC, "", "notes.txt").kind).toBe("document");
  });

  it(".md extension fallback -> document", () => {
    expect(classify(GENERIC, "", "README.md").kind).toBe("document");
  });

  it("Office PK\\x03\\x04 magic bytes -> document (route-to-model/defer)", () => {
    const b = bytes([0x50, 0x4b, 0x03, 0x04]);
    expect(classify(b, "", "report.docx").kind).toBe("document");
  });
});

describe("classify — unknown + defense in depth", () => {
  it("unrecognized bytes + generic mime + unknown extension -> unknown", () => {
    const result = classify(GENERIC, "application/octet-stream", "blob.bin");
    expect(result.kind).toBe("unknown");
  });

  it("mime present but bytes disagree -> trust the magic bytes (image bytes win over pdf mime)", () => {
    const pngBytes = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]);
    const result = classify(pngBytes, "application/pdf", "mislabeled.pdf");
    expect(result.kind).toBe("image");
  });

  it("mime absent -> falls back to extension", () => {
    expect(classify(GENERIC, "", "plan.md").kind).toBe("document");
  });
});
