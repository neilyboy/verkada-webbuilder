// Layout presets. Each defines a CSS grid and an ordered list of slot area
// names. The number of slots equals areas.length.
const A = 'abcdefghijklmnop'.split('');

function names(n) {
  return A.slice(0, n);
}

export const LAYOUTS = {
  single: {
    id: 'single',
    name: 'Single',
    slots: 1,
    columns: '1fr',
    rows: '1fr',
    areas: ['"a"'],
    order: names(1),
  },
  'side-2': {
    id: 'side-2',
    name: '2 Side by Side',
    slots: 2,
    columns: '1fr 1fr',
    rows: '1fr',
    areas: ['"a b"'],
    order: names(2),
  },
  'side-3': {
    id: 'side-3',
    name: '3 Wide',
    slots: 3,
    columns: '1fr 1fr 1fr',
    rows: '1fr',
    areas: ['"a b c"'],
    order: names(3),
  },
  'stack-2': {
    id: 'stack-2',
    name: '2 Stacked',
    slots: 2,
    columns: '1fr',
    rows: '1fr 1fr',
    areas: ['"a"', '"b"'],
    order: names(2),
  },
  'grid-2x2': {
    id: 'grid-2x2',
    name: '2 x 2 Grid',
    slots: 4,
    columns: '1fr 1fr',
    rows: '1fr 1fr',
    areas: ['"a b"', '"c d"'],
    order: names(4),
  },
  'grid-3x3': {
    id: 'grid-3x3',
    name: '3 x 3 Grid',
    slots: 9,
    columns: '1fr 1fr 1fr',
    rows: '1fr 1fr 1fr',
    areas: ['"a b c"', '"d e f"', '"g h i"'],
    order: names(9),
  },
  'one-plus-three': {
    id: 'one-plus-three',
    name: '1 Big + 3 (right)',
    slots: 4,
    columns: '2fr 1fr',
    rows: '1fr 1fr 1fr',
    areas: ['"a b"', '"a c"', '"a d"'],
    order: names(4),
  },
  'one-plus-four': {
    id: 'one-plus-four',
    name: '1 Big + 4 (right)',
    slots: 5,
    columns: '2fr 1fr',
    rows: '1fr 1fr 1fr 1fr',
    areas: ['"a b"', '"a c"', '"a d"', '"a e"'],
    order: names(5),
  },
  'feature-bottom-3': {
    id: 'feature-bottom-3',
    name: '1 Big top + 3 bottom',
    slots: 4,
    columns: '1fr 1fr 1fr',
    rows: '2fr 1fr',
    areas: ['"a a a"', '"b c d"'],
    order: names(4),
  },
  'grid-2x3': {
    id: 'grid-2x3',
    name: '6 (3 x 2)',
    slots: 6,
    columns: '1fr 1fr 1fr',
    rows: '1fr 1fr',
    areas: ['"a b c"', '"d e f"'],
    order: names(6),
  },
  'grid-4x2': {
    id: 'grid-4x2',
    name: '8 (4 x 2)',
    slots: 8,
    columns: '1fr 1fr 1fr 1fr',
    rows: '1fr 1fr',
    areas: ['"a b c d"', '"e f g h"'],
    order: names(8),
  },
  'grid-4x3': {
    id: 'grid-4x3',
    name: '12 (4 x 3)',
    slots: 12,
    columns: '1fr 1fr 1fr 1fr',
    rows: '1fr 1fr 1fr',
    areas: ['"a b c d"', '"e f g h"', '"i j k l"'],
    order: names(12),
  },
  'grid-4x4': {
    id: 'grid-4x4',
    name: '16 (4 x 4)',
    slots: 16,
    columns: '1fr 1fr 1fr 1fr',
    rows: '1fr 1fr 1fr 1fr',
    areas: ['"a b c d"', '"e f g h"', '"i j k l"', '"m n o p"'],
    order: names(16),
  },
  'one-plus-five': {
    id: 'one-plus-five',
    name: '1 Big + 5 (right)',
    slots: 6,
    columns: '2fr 1fr',
    rows: '1fr 1fr 1fr 1fr 1fr',
    areas: ['"a b"', '"a c"', '"a d"', '"a e"', '"a f"'],
    order: names(6),
  },
  'feature-bottom-4': {
    id: 'feature-bottom-4',
    name: '1 Big top + 4 bottom',
    slots: 5,
    columns: '1fr 1fr 1fr 1fr',
    rows: '2fr 1fr',
    areas: ['"a a a a"', '"b c d e"'],
    order: names(5),
  },
};

export const LAYOUT_LIST = Object.values(LAYOUTS);

export function getLayout(id) {
  return LAYOUTS[id] || LAYOUTS['grid-2x2'];
}
