import * as T from "three";
import type { Vec3 } from "./cloth";
/** Four render triangles per simulation triangle, with shared edge vertices.
 * Collision projection also covers edge midpoints, where a coarse face can cut into a limb. */
export function createRenderSurface(source: T.BufferGeometry) {
  const count = source.getAttribute("position").count,
    uv = source.getAttribute("uv"),
    index = source.index!;
  const bindings: Array<[number, number]> = Array.from(
    { length: count },
    (_, i) => [i, i],
  );
  const uvs: number[] = [];
  for (let i = 0; i < count; i++) uvs.push(uv.getX(i), uv.getY(i));
  const cache = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const old = cache.get(key);
    if (old !== undefined) return old;
    const id = bindings.length;
    bindings.push([a, b]);
    uvs.push((uv.getX(a) + uv.getX(b)) / 2, (uv.getY(a) + uv.getY(b)) / 2);
    cache.set(key, id);
    return id;
  };
  const indices: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i),
      b = index.getX(i + 1),
      c = index.getX(i + 2),
      ab = mid(a, b),
      bc = mid(b, c),
      ca = mid(c, a);
    indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const geometry = new T.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(new Float32Array(bindings.length * 3), 3),
  );
  const update = (positions: Float32Array, collide?: (p: Vec3) => Vec3) => {
    const out = geometry.getAttribute("position");
    for (let i = 0; i < bindings.length; i++) {
      const [a, b] = bindings[i];
      let p: Vec3 = [
        (positions[a * 3] + positions[b * 3]) / 2,
        (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
        (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
      ];
      if (collide) for (let j = 0; j < 3; j++) p = collide(p);
      out.setXYZ(i, ...p);
    }
    out.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };
  return { geometry, update };
}
