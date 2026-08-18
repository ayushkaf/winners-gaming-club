// core/lines.js — 30 fixed paylines on a 5x3 window.
// Each entry is the row (0=top, 1=middle, 2=bottom) the line touches on reels 1..5.
// Left-to-right evaluation only.
export const LINES = [
  [1, 1, 1, 1, 1], // 1  middle
  [0, 0, 0, 0, 0], // 2  top
  [2, 2, 2, 2, 2], // 3  bottom
  [0, 1, 2, 1, 0], // 4  V
  [2, 1, 0, 1, 2], // 5  inverted V
  [1, 0, 0, 0, 1], // 6
  [1, 2, 2, 2, 1], // 7
  [0, 0, 1, 2, 2], // 8
  [2, 2, 1, 0, 0], // 9
  [1, 0, 1, 2, 1], // 10
  [1, 2, 1, 0, 1], // 11
  [0, 1, 1, 1, 0], // 12
  [2, 1, 1, 1, 2], // 13
  [0, 1, 0, 1, 0], // 14
  [2, 1, 2, 1, 2], // 15
  [1, 1, 0, 1, 1], // 16
  [1, 1, 2, 1, 1], // 17
  [0, 0, 2, 0, 0], // 18
  [2, 2, 0, 2, 2], // 19
  [0, 2, 0, 2, 0], // 20
  [2, 0, 2, 0, 2], // 21
  [1, 0, 2, 0, 1], // 22
  [1, 2, 0, 2, 1], // 23
  [0, 1, 2, 2, 2], // 24
  [2, 1, 0, 0, 0], // 25
  [0, 2, 2, 2, 0], // 26
  [2, 0, 0, 0, 2], // 27
  [0, 2, 1, 2, 0], // 28
  [2, 0, 1, 0, 2], // 29
  [1, 1, 1, 2, 1], // 30
];

// Flat Int8 copy for the hot evaluation loop.
export const LINES_FLAT = Int8Array.from(LINES.flat());
export const N_LINES = LINES.length;
