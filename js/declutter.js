// Screen-space label placement so map labels don't sit on top of each other.
// Boxes are centred on (x, y) in container pixels.
export function boxes(pad = 3) {
  const list = [];
  const hit = (x, y, w, h) => list.some(b => Math.abs(b.x - x) * 2 < b.w + w + pad * 2 && Math.abs(b.y - y) * 2 < b.h + h + pad * 2);
  return {
    hit,
    add(x, y, w, h) { list.push({ x, y, w, h }); },
    // first offset [dx, dy] where the box fits; null if none does
    place(x, y, w, h, offsets = [[0, 0]]) {
      for (const [dx, dy] of offsets) if (!hit(x + dx, y + dy, w, h)) { list.push({ x: x + dx, y: y + dy, w, h }); return [dx, dy]; }
      return null;
    }
  };
}
