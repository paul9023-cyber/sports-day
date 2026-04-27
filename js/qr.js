/*!
 * 작은 QR 코드 생성기 (Byte 모드, 오류정정 L, ISO/IEC 18004 준거)
 * URL 같은 짧은 ASCII 문자열(최대 ~230자) 생성용으로 충분합니다.
 * 외부 의존성 없음. MIT 라이선스 기반으로 자체 구현.
 */

function bchTypeInfo(data) {
  let d = data << 10;
  for (let i = 0; i < 5; i++) {
    if (d >>> (15 - 1 - i) & 1) d ^= 0x537 << (5 - 1 - i);
  }
  return ((data << 10) | d) ^ 0x5412;
}

// Galois Field
const EXP = new Array(512), LOG = new Array(256);
(function initGF(){
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = data.slice().concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      res[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return res.slice(data.length);
}

// 버전별 용량(Byte 모드, L 수준)
// index: version 1..10
const BYTE_CAPACITY_L = [null, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];

// 버전별 총 데이터 코드워드 수(L)
const TOTAL_DATA_L = [null, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];

// 버전별 EC 코드워드 수 per block (L)
const EC_PER_BLOCK_L = [null, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];

// 버전별 블록 수 (L)
const BLOCKS_L = [null, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

function pickVersion(len) {
  for (let v = 1; v <= 10; v++) {
    if (len <= BYTE_CAPACITY_L[v]) return v;
  }
  throw new Error("데이터가 너무 깁니다 (QR)");
}

function encodeData(str, version) {
  const bytes = new TextEncoder().encode(str);
  const bits = [];
  function push(n, count) {
    for (let i = count - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  }
  push(0b0100, 4); // Byte mode
  const lenBits = version < 10 ? 8 : 16;
  push(bytes.length, lenBits);
  for (const b of bytes) push(b, 8);
  // 종결자
  const capacity = TOTAL_DATA_L[version] * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // 패딩 바이트
  const pad = [0xEC, 0x11];
  for (let i = 0; bits.length < capacity; i++) {
    push(pad[i % 2], 8);
  }
  // bits → bytes
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  return data;
}

function interleave(dataCodewords, version) {
  const blocks = BLOCKS_L[version];
  const totalData = TOTAL_DATA_L[version];
  const ecLen = EC_PER_BLOCK_L[version];
  const shortLen = Math.floor(totalData / blocks);
  const longCount = totalData % blocks;

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < blocks; i++) {
    const len = shortLen + (i >= blocks - longCount ? 1 : 0);
    const d = dataCodewords.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(d);
    ecBlocks.push(rsEncode(d, ecLen));
  }

  const out = [];
  const maxDataLen = shortLen + (longCount > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLen; i++) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

function getSize(version) { return 17 + version * 4; }

function buildMatrix(version, codewords) {
  const size = getSize(version);
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFinder(r, c) {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const y = r + i, x = c + j;
      if (y < 0 || x < 0 || y >= size || x >= size) continue;
      reserved[y][x] = true;
      const inOuter = (i === 0 || i === 6 || j === 0 || j === 6) && i >= 0 && i <= 6 && j >= 0 && j <= 6;
      const inInner = i >= 2 && i <= 4 && j >= 2 && j <= 4;
      m[y][x] = inOuter || inInner ? 1 : 0;
    }
  }
  setFinder(0, 0);
  setFinder(0, size - 7);
  setFinder(size - 7, 0);

  // 타이밍 패턴
  for (let i = 8; i < size - 8; i++) {
    m[6][i] = m[i][6] = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = reserved[i][6] = true;
  }

  // Alignment (v2~v10: 단일 패턴 at 크기-7, 크기-7)
  if (version >= 2) {
    const positions = {
      2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30], 6:[6,34],
      7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50]
    }[version];
    for (const r of positions) for (const c of positions) {
      if ((r === 6 && c === 6) || (r === 6 && c === positions[positions.length-1]) || (r === positions[positions.length-1] && c === 6)) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const y = r + i, x = c + j;
        reserved[y][x] = true;
        const isOuter = Math.max(Math.abs(i), Math.abs(j)) === 2;
        const isCenter = i === 0 && j === 0;
        m[y][x] = isOuter || isCenter ? 1 : 0;
      }
    }
  }

  // 다크 모듈
  m[size - 8][8] = 1;
  reserved[size - 8][8] = true;

  // 형식정보 예약
  for (let i = 0; i <= 8; i++) { reserved[8][i] = true; reserved[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }

  // 데이터 배치
  let bitIdx = 0;
  const bits = [];
  for (const cw of codewords) for (let b = 7; b >= 0; b--) bits.push((cw >>> b) & 1);

  let row = size - 1, col = size - 1, dir = -1;
  while (col > 0) {
    if (col === 6) col--;
    for (let _ = 0; _ < size; _++) {
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          m[row][c] = bitIdx < bits.length ? bits[bitIdx++] : 0;
        }
      }
      row += dir;
      if (row < 0 || row >= size) {
        dir = -dir;
        row += dir;
        col -= 2;
        break;
      }
    }
  }

  return { m, reserved, size };
}

function applyMask(m, reserved, maskIdx) {
  const size = m.length;
  const formulas = [
    (r,c) => (r+c)%2===0,
    (r,c) => r%2===0,
    (r,c) => c%3===0,
    (r,c) => (r+c)%3===0,
    (r,c) => (Math.floor(r/2)+Math.floor(c/3))%2===0,
    (r,c) => (r*c)%2 + (r*c)%3 === 0,
    (r,c) => ((r*c)%2 + (r*c)%3) % 2 === 0,
    (r,c) => ((r+c)%2 + (r*c)%3) % 2 === 0,
  ];
  const fn = formulas[maskIdx];
  const out = m.map(r => r.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!reserved[r][c] && fn(r, c)) out[r][c] ^= 1;
  }
  return out;
}

function placeFormatInfo(m, maskIdx) {
  const data = (0b01 << 3) | maskIdx; // EC=L(01), mask
  const info = bchTypeInfo(data);
  const size = m.length;
  // 좌상단 L자: bit 0..5 → 열 8 아래로, bit 6 (7,8), bit 7 (8,8), bit 8 (8,7), bit 9..14 → 행 8 왼쪽으로
  for (let i = 0; i <= 5; i++) m[i][8] = (info >>> i) & 1;
  m[7][8] = (info >>> 6) & 1;
  m[8][8] = (info >>> 7) & 1;
  m[8][7] = (info >>> 8) & 1;
  for (let i = 9; i <= 14; i++) m[8][14 - i] = (info >>> i) & 1;
  // 우상단: 비트 0-7 (행 8, 오른쪽에서 왼쪽으로)
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = (info >>> i) & 1;
  // 좌하단: 비트 8-14 (열 8, 아래로)
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = (info >>> i) & 1;
  // 다크 모듈
  m[size - 8][8] = 1;
}

function evaluateMask(m) {
  const size = m.length;
  let penalty = 0;
  // 규칙 1: 연속 같은 색
  function scan(line) {
    let s = 0;
    for (let i = 0; i < line.length; i++) {
      if (i > 0 && line[i] === line[i - 1]) s++;
      else { if (s >= 5) penalty += s - 2; s = 1; }
    }
    if (s >= 5) penalty += s - 2;
  }
  for (let r = 0; r < size; r++) scan(m[r]);
  for (let c = 0; c < size; c++) scan(m.map(r => r[c]));
  return penalty;
}

function buildQR(str) {
  const len = new TextEncoder().encode(str).length;
  const version = pickVersion(len);
  const data = encodeData(str, version);
  const codewords = interleave(data, version);
  const { m, reserved, size } = buildMatrix(version, codewords);

  let best = null;
  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const masked = applyMask(m, reserved, maskIdx);
    placeFormatInfo(masked, maskIdx);
    const p = evaluateMask(masked);
    if (!best || p < best.p) best = { matrix: masked, p, maskIdx };
  }
  return { matrix: best.matrix, size };
}

export function renderQRCode(container, text, pixelSize = 10, margin = 4) {
  const { matrix, size } = buildQR(text);
  const total = size + margin * 2;
  const dim = total * pixelSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" style="display:block;max-width:100%;height:auto;">`;
  svg += `<rect width="${total}" height="${total}" fill="#ffffff"/>`;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        path += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  svg += `<path d="${path}" fill="#000000"/></svg>`;
  container.innerHTML = svg;
}
