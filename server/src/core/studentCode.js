// Portable student-code generator.
//
// The server version (src/lib/studentCode.js) imports node:crypto's randomInt.
// This mirror uses global Web Crypto so it stays dependency-free under PGlite
// and `node --test`.
//
// Same alphabet and length as the server, so codes are indistinguishable:
// 32 unambiguous characters (no 0/O/1/I), 8 chars long.

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

// Uniform index in [0, ALPHABET.length) via rejection sampling, so no character
// is very slightly favoured the way a plain `% 32` on a byte would be. 32
// divides 256 evenly, so with a Uint8Array there is actually nothing to reject;
// the guard is kept for correctness if the alphabet size ever changes.
function randomIndex(max) {
  const limit = Math.floor(256 / max) * max;
  const buf = new Uint8Array(1);
  let value;
  do {
    globalThis.crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

export function generateStudentCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomIndex(ALPHABET.length)];
  }
  return code;
}

export const generateCode = generateStudentCode;
export const generateTeacherCode = generateStudentCode;
