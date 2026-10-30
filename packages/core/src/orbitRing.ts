/** Closed, decorative 3D geometry. This never reconstructs or changes a customer's product.
 * A perspective camera projects an orbiting annulus; depth sorting and directional shading
 * are calculated before libass draws the faces. No executable/model-authored asset is accepted. */
export function orbitRingAss(seconds: number, color = "0xFFFFFF"): string {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15)
    throw new Error("INVALID_RING_DURATION");
  if (!/^0x[0-9A-Fa-f]{6}$/.test(color)) throw new Error("INVALID_RING_COLOR");
  const rgb = [2, 4, 6].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Ring,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const time = (frame: number) => {
    const cs = Math.round((frame * 100) / 24);
    return `0:00:${Math.floor(cs / 100)
      .toString()
      .padStart(2, "0")}.${(cs % 100).toString().padStart(2, "0")}`;
  };
  const lines: string[] = [];
  for (let frame = 0; frame < seconds * 24; frame++) {
    const t = frame / 24;
    const yaw = 0.23 * Math.sin(t * 0.85),
      tilt = 1.05 + 0.07 * Math.cos(t * 0.65);
    const vertex = (angle: number, radius: number) => {
      const x = radius * Math.cos(angle),
        y = radius * Math.sin(angle);
      const ry = y * Math.cos(tilt),
        rz = y * Math.sin(tilt);
      const rx = x * Math.cos(yaw) + rz * Math.sin(yaw);
      const z = -x * Math.sin(yaw) + rz * Math.cos(yaw);
      const perspective = 4 / (4 - z);
      return {
        x: Math.round(360 + 192 * rx * perspective),
        y: Math.round(1010 + 192 * ry * perspective),
        z,
      };
    };
    const faces = Array.from({ length: 48 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 48,
        b = ((i + 1) * 2 * Math.PI) / 48;
      const points = [vertex(a, 1), vertex(b, 1), vertex(b, 0.975), vertex(a, 0.975)];
      const light = 0.55 + 0.45 * Math.max(0, Math.cos(a - t * 0.8));
      const channel = (v: number) =>
        Math.round(v * light)
          .toString(16)
          .padStart(2, "0")
          .toUpperCase();
      return {
        points,
        depth: points.reduce((sum, p) => sum + p.z, 0),
        color: `${channel(rgb[2] ?? 255)}${channel(rgb[1] ?? 255)}${channel(rgb[0] ?? 255)}`,
      };
    }).sort((a, b) => a.depth - b.depth);
    const opacity = Math.min(1, t / 0.35, (seconds - t) / 0.35);
    const alpha = Math.round(255 * (1 - Math.max(0, opacity) * 0.82))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    for (const face of faces) {
      const [first, ...rest] = face.points;
      if (!first) throw new Error("EMPTY_RING_FACE");
      const path = `m ${first.x} ${first.y} l ${rest.map((p) => `${p.x} ${p.y}`).join(" ")} ${first.x} ${first.y}`;
      lines.push(
        `Dialogue: 0,${time(frame)},${time(frame + 1)},Ring,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\shad0\\1c&H${face.color}&\\alpha&H${alpha}&\\p1}${path}{\\p0}`,
      );
    }
  }
  return header + lines.join("\n") + "\n";
}
