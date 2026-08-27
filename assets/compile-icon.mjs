import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const W = 256, H = 256;
const cx = 128, cy = 128;

const BG = "#16202C";
const ARM_C = "#C89028";
const RING_C = "#3A6878";
const OCT_DARK = "#C25820";
//const OCT_LIGHT = "#E08840";
const OCT_LIGHT = ARM_C;

const OCT_A = 26;  // outer oct apothem = arm start
const STEP = 14;   // lateral meander step width

// Arm shaft lengths — total radial reach = RING_R - OCT_A = 74
// out → step CW → out → step CCW (back) → out → step CW → out
const S1 = 16;     // first outward shaft
const S2 = 18;     // second outward shaft
const S3 = 18;     // third outward shaft
const S4 = 22;     // fourth outward shaft (tip reaches ring)

// Taper: arm ribbon narrows from base to tip
const ARM_W_BASE = 3.5;  // half-width at base (near octagon)
const ARM_W_TIP = 1.4;   // half-width at tip (at ring)

const rad = (d) => (d * Math.PI) / 180;
const f = (n) => n.toFixed(2);

// --- Containment rings ---
// Concentric circles radiating outward from the arm tips — pond ripple effect
// Each ring progressively thinner and more transparent
const RING_R = 100;       // primary ring (where arms dock)
const RING_R2 = 107;     // first ripple out
const RING_R3 = 114;     // second ripple out
const RING_R4 = 121;     // third ripple out

// --- Octagon paths (three-layer IAM model) ---
function octPath(apothem) {
  const vr = apothem / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, i) => {
    const a = rad(247.5 + i * 45);
    return `${i === 0 ? "M" : "L"}${f(cx + vr * Math.cos(a))},${f(cy + vr * Math.sin(a))}`;
  }).join(" ") + " Z";
}

// --- Outlined arm with tapering width ---
// For each arm centerline, compute miter-offset left/right sides to form a closed polygon
function outlineArm(centerPoints) {
  const n = centerPoints.length;
  const leftSide = [];
  const rightSide = [];

  for (let j = 0; j < n; j++) {
    // Interpolate width: 0 at start → 1 at end
    const t = j / (n - 1);
    const halfW = ARM_W_BASE + (ARM_W_TIP - ARM_W_BASE) * t;

    let inDx = 0, inDy = 0, outDx = 0, outDy = 0;

    if (j > 0) {
      const dx = centerPoints[j][0] - centerPoints[j - 1][0];
      const dy = centerPoints[j][1] - centerPoints[j - 1][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      inDx = dx / len;
      inDy = dy / len;
    }
    if (j < n - 1) {
      const dx = centerPoints[j + 1][0] - centerPoints[j][0];
      const dy = centerPoints[j + 1][1] - centerPoints[j][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      outDx = dx / len;
      outDy = dy / len;
    }

    if (j === 0) { inDx = outDx; inDy = outDy; }
    if (j === n - 1) { outDx = inDx; outDy = inDy; }

    // Left normals
    const inNx = -inDy, inNy = inDx;
    const outNx = -outDy, outNy = outDx;

    // Miter direction: bisector of the two normals
    let mx = inNx + outNx;
    let my = inNy + outNy;
    const mLen = Math.sqrt(mx * mx + my * my);

    if (mLen < 0.001) {
      mx = inNx;
      my = inNy;
    } else {
      mx /= mLen;
      my /= mLen;
    }

    // Scale miter by 1/cos(half-angle) for proper miter length
    const dot = inNx * mx + inNy * my;
    const miterScale = dot > 0.001 ? halfW / dot : halfW;

    leftSide.push([
      centerPoints[j][0] + mx * miterScale,
      centerPoints[j][1] + my * miterScale,
    ]);
    rightSide.push([
      centerPoints[j][0] - mx * miterScale,
      centerPoints[j][1] - my * miterScale,
    ]);
  }

  // Close the shape: left side forward, right side reversed
  const allPoints = [...leftSide, ...rightSide.reverse()];
  return allPoints.map((p, i) => `${i === 0 ? "M" : "L"}${f(p[0])},${f(p[1])}`).join(" ") + " Z";
}

// --- 8 meander arms, all stepping CW, tips dock to the ring ---
const armPaths = Array.from({ length: 8 }, (_, i) => {
  const theta = (270 + i * 45) % 360;
  const a = rad(theta);
  const dx = Math.cos(a), dy = Math.sin(a);

  // CW perpendicular: (-dy, dx) — same direction for all arms
  const px = -dy, py = dx;

  const p0 = [cx + OCT_A * dx, cy + OCT_A * dy];     // start at octagon face
  const p1 = [p0[0] + S1 * dx, p0[1] + S1 * dy];     // out
  const p2 = [p1[0] + STEP * px, p1[1] + STEP * py];  // step CW
  const p3 = [p2[0] + S2 * dx, p2[1] + S2 * dy];     // out
  const p4 = [p3[0] - STEP * px, p3[1] - STEP * py];  // step back CCW
  const p5 = [p4[0] + S3 * dx, p4[1] + S3 * dy];     // out
  const p6 = [p5[0] + STEP * px, p5[1] + STEP * py];  // step CW
  const p7 = [p6[0] + S4 * dx, p6[1] + S4 * dy];     // out to tip (docks at ring)

  return outlineArm([p0, p1, p2, p3, p4, p5, p6, p7]);
});

// --- SVG assembly ---
const maskPaths = armPaths.map(d =>
  `    <path d="${d}" fill="black" stroke="black" stroke-width="2" stroke-linejoin="miter"/>`
).join("\n");

const armElements = armPaths.map(d =>
  `  <path d="${d}" fill="none" stroke="${ARM_C}" stroke-width="1.2" stroke-linejoin="miter"/>`
).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="256" height="256">
  <defs>
    <radialGradient id="bg-fade" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${BG}" stop-opacity="1"/>
      <stop offset="70%" stop-color="${BG}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
    <mask id="ring-mask">
      <rect width="${W}" height="${H}" fill="white"/>
${maskPaths}
    </mask>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg-fade)"/>
  <!-- Concentric containment rings — pond ripple effect, masked where arms dock -->
  <circle cx="${cx}" cy="${cy}" r="${RING_R}" fill="none" stroke="${RING_C}" stroke-width="2.0" mask="url(#ring-mask)"/>
  <circle cx="${cx}" cy="${cy}" r="${RING_R2}" fill="none" stroke="${RING_C}" stroke-width="1.5" opacity="0.55" mask="url(#ring-mask)"/>
  <circle cx="${cx}" cy="${cy}" r="${RING_R3}" fill="none" stroke="${RING_C}" stroke-width="1.0" opacity="0.3" mask="url(#ring-mask)"/>
  <circle cx="${cx}" cy="${cy}" r="${RING_R4}" fill="none" stroke="${RING_C}" stroke-width="0.7" opacity="0.15" mask="url(#ring-mask)"/>
  <!-- 8 meander arms: outlined, tapered, docking to ring -->
${armElements}
  <!-- Three concentric octagons (permission boundary / base config / operating policy) -->
  <path d="${octPath(26)}" fill="${BG}" stroke="${OCT_DARK}" stroke-width="1.8"/>
  <path d="${octPath(18)}" fill="none" stroke="${OCT_LIGHT}" stroke-width="3.0"/>
  <path d="${octPath(10)}" fill="${OCT_DARK}" stroke="none"/>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outPath = join(__dirname, 'hecatoncheires-icon.svg');
const docsPublicPath = join(repoRoot, 'packages', 'docs', 'public', 'hecatoncheires-icon.svg');

writeFileSync(outPath, svg, 'utf-8');
writeFileSync(docsPublicPath, svg, 'utf-8');

// eslint-disable-next-line no-undef
console.log('Written to:', outPath);
// eslint-disable-next-line no-undef
console.log('Written to:', docsPublicPath);
