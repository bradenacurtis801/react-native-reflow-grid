import type { SymbolViewProps } from 'expo-symbols';

/** A symbol's name on each platform: SF Symbols on iOS, Material Symbols elsewhere. */
export type Glyph = SymbolViewProps['name'];

/** A made-up app: a gradient square with a symbol on it. */
export interface AppItem {
  kind: 'app';
  id: string;
  name: string;
  glyph: Glyph;
  colors: readonly [string, string];
  /** The symbol's colour. @default white */
  ink?: string;
  badge?: number;
}

export interface FolderItem {
  kind: 'folder';
  id: string;
  name: string;
  apps: AppItem[];
}

export type Entry = AppItem | FolderItem;

const glyph = (ios: string, other: string) => ({ ios, android: other, web: other }) as Glyph;

const GLYPHS = {
  phone: glyph('phone.fill', 'call'),
  compass: glyph('safari.fill', 'explore'),
  music: glyph('music.note', 'music_note'),
  message: glyph('message.fill', 'chat'),
  mail: glyph('envelope.fill', 'mail'),
  camera: glyph('camera.fill', 'photo_camera'),
  photo: glyph('photo.fill', 'image'),
  map: glyph('map.fill', 'map'),
  clock: glyph('clock.fill', 'schedule'),
  cloud: glyph('cloud.sun.fill', 'partly_cloudy_day'),
  note: glyph('note.text', 'description'),
  check: glyph('checklist', 'checklist'),
  cart: glyph('cart.fill', 'shopping_cart'),
  bag: glyph('bag.fill', 'shopping_bag'),
  gift: glyph('gift.fill', 'redeem'),
  card: glyph('creditcard.fill', 'credit_card'),
  chart: glyph('chart.bar.fill', 'bar_chart'),
  bank: glyph('building.columns.fill', 'account_balance'),
  book: glyph('book.fill', 'menu_book'),
  grad: glyph('graduationcap.fill', 'school'),
  code: glyph('chevron.left.forwardslash.chevron.right', 'code'),
  terminal: glyph('terminal.fill', 'terminal'),
  wrench: glyph('wrench.and.screwdriver.fill', 'build'),
  gear: glyph('gearshape.fill', 'settings'),
  lock: glyph('lock.fill', 'lock'),
  play: glyph('play.fill', 'play_arrow'),
  tv: glyph('tv.fill', 'tv'),
  news: glyph('newspaper.fill', 'newspaper'),
  run: glyph('figure.run', 'directions_run'),
  golf: glyph('figure.golf', 'golf_course'),
  trophy: glyph('trophy.fill', 'trophy'),
  food: glyph('fork.knife', 'restaurant'),
  cup: glyph('cup.and.saucer.fill', 'local_cafe'),
  plane: glyph('airplane', 'flight'),
  car: glyph('car.fill', 'directions_car'),
  heart: glyph('heart.fill', 'favorite'),
  pills: glyph('pills.fill', 'medication'),
  wave: glyph('waveform', 'graphic_eq'),
  eye: glyph('eye.fill', 'visibility'),
  bolt: glyph('bolt.fill', 'bolt'),
  leaf: glyph('leaf.fill', 'eco'),
  bird: glyph('bird.fill', 'raven'),
} as const;

const PAINT = {
  green: ['#6ee76b', '#27b53f'],
  blue: ['#4aa8ff', '#1366e8'],
  navy: ['#14609f', '#0a3d72'],
  indigo: ['#5560ff', '#2c34d6'],
  teal: ['#25c3e0', '#0a93b8'],
  orange: ['#ff9a3d', '#ee6410'],
  red: ['#ff6173', '#f0173d'],
  pink: ['#ff7ab8', '#e0348a'],
  purple: ['#b476ff', '#7430d8'],
  yellow: ['#ffe45c', '#f5b800'],
  black: ['#2b2b2e', '#0b0b0d'],
  white: ['#ffffff', '#e9eaee'],
  gray: ['#a8adb7', '#6b717c'],
} as const;

type Options = { badge?: number; ink?: string };

function app(name: string, symbol: keyof typeof GLYPHS, paint: keyof typeof PAINT, options: Options = {}): AppItem {
  const ink = options.ink ?? (paint === 'white' ? '#1366e8' : '#ffffff');
  return { kind: 'app', id: `app-${name}`, name, glyph: GLYPHS[symbol], colors: PAINT[paint], ink, badge: options.badge };
}

function folder(name: string, apps: AppItem[]): FolderItem {
  return { kind: 'folder', id: `folder-${name}`, name, apps };
}

export const HOME: Entry[] = [
  app('Taxes', 'bank', 'navy'),
  folder('Education', [app('Courses', 'grad', 'blue'), app('Editor', 'code', 'black'), app('Shell', 'terminal', 'indigo'), app('Reader', 'book', 'orange'), app('Repos', 'code', 'white', { ink: '#111' }), app('Cloud', 'cloud', 'navy'), app('Snippets', 'note', 'gray')]),
  folder('Utilities', [app('Settings', 'gear', 'gray', { badge: 1 }), app('Tools', 'wrench', 'black')]),
  folder('Shopping', [app('Basket', 'cart', 'yellow', { badge: 80, ink: '#111' }), app('Market', 'bag', 'green'), app('Auctions', 'gift', 'white'), app('Outlet', 'bag', 'red'), app('Deals', 'gift', 'purple', { badge: 25 }), app('Outfit', 'bag', 'navy'), app('Sport Co', 'run', 'black'), app('Checkout', 'card', 'indigo'), app('Electro', 'bolt', 'blue'), app('Grocer', 'leaf', 'green'), app('Wallet', 'card', 'black')]),
  folder('Entertainment', [app('Streams', 'play', 'red', { badge: 1 }), app('Cinema', 'tv', 'black'), app('Prime Time', 'tv', 'blue')]),
  folder('News', [app('Headlines', 'news', 'navy'), app('Scores', 'trophy', 'red'), app('Local', 'news', 'indigo')]),
  folder('Productivity', [app('Docs', 'note', 'blue', { badge: 128 }), app('Slides', 'chart', 'yellow'), app('Sheets', 'chart', 'green'), app('Drive', 'cloud', 'teal'), app('Notes', 'note', 'purple'), app('Tasks', 'check', 'white')]),
  folder('Sports', [app('Fantasy', 'trophy', 'navy', { badge: 66 }), app('Birdies', 'golf', 'teal'), app('Fairway', 'golf', 'green'), app('Tee Times', 'clock', 'black'), app('Tour', 'golf', 'white'), app('Lines', 'chart', 'green')]),
  folder('Food', [app('Pizza', 'food', 'blue', { badge: 3 }), app('Roast', 'food', 'red'), app('Subs', 'food', 'green'), app('Noodles', 'food', 'red'), app('Burgers', 'food', 'orange'), app('Chicken', 'food', 'yellow'), app('Tacos', 'food', 'purple'), app('Coffee', 'cup', 'orange'), app('Bakery', 'cup', 'pink')]),
  folder('Business', [app('Identity', 'lock', 'blue'), app('Verify', 'check', 'navy'), app('Passwords', 'lock', 'red'), app('Codes', 'lock', 'white')]),
  folder('Travel', [app('Flights', 'plane', 'navy'), app('Hearts Air', 'heart', 'blue')]),
  app('Hello', 'phone', 'teal'),
  app('Speak', 'wave', 'indigo'),
  app('Finance', 'chart', 'teal'),
  folder('Health', [app('Refills', 'pills', 'yellow', { ink: '#111' }), app('Pharmacy', 'pills', 'white'), app('Records', 'heart', 'purple'), app('Care', 'heart', 'indigo'), app('Pocket Rx', 'pills', 'teal')]),
  app('Fantasy FC', 'trophy', 'teal'),
  app('Supreme', 'golf', 'orange'),
  app('Sparrow', 'bird', 'white', { ink: '#0a93b8' }),
  app('Bank', 'bank', 'blue'),
  app('Live Shop', 'bolt', 'black', { ink: '#ffe45c' }),
  app('Wallpapers', 'photo', 'white', { ink: '#111' }),
  app('Sight', 'eye', 'black'),
  app('Weather', 'cloud', 'blue'),
  app('Maps', 'map', 'green'),
  // The second page.
  app('Camera', 'camera', 'gray'),
  app('Photos', 'photo', 'pink'),
  app('Mail', 'mail', 'blue', { badge: 12 }),
  app('Clock', 'clock', 'black'),
  app('Reminders', 'check', 'white'),
  app('Drive Mode', 'car', 'indigo'),
];

/** The app that opens: the Safari example. */
export const SAFARI = 'app-Safari';

export const DOCK: Entry[] = [
  app('Phone', 'phone', 'green', { badge: 121 }),
  app('Safari', 'compass', 'white'),
  folder('Chat', [app('Messages', 'message', 'green', { badge: 855 }), app('Assistant', 'bolt', 'white', { ink: '#111' }), app('Console', 'terminal', 'black'), app('Builder', 'wrench', 'indigo'), app('Rooms', 'message', 'purple'), app('Radar', 'wave', 'gray')]),
  app('Music', 'music', 'red'),
];

/** What an entry's badge says: its own, or its apps' together. */
export const badgeOf = (entry: Entry) => (entry.kind === 'app' ? (entry.badge ?? 0) : entry.apps.reduce((sum, a) => sum + (a.badge ?? 0), 0));

/**
 * `entries` with the app `dragged` joined to `target`: into it if it's a folder, and with it into a new one, in its place, if
 * it's an app. `id` is what the entry in the target's place is called then. Nothing for what can't be joined.
 */
export function joined(entries: readonly Entry[], dragged: string, target: string, newId: string): { entries: Entry[]; id: string } | undefined {
  const from = entries.find((e) => e.id === dragged);
  const onto = entries.find((e) => e.id === target);
  if (from?.kind !== 'app' || !onto) return undefined;
  const into: FolderItem = onto.kind === 'folder' ? { ...onto, apps: [...onto.apps, from] } : { kind: 'folder', id: newId, name: 'Folder', apps: [onto, from] };
  return { entries: entries.flatMap((e) => (e.id === dragged ? [] : e.id === target ? [into] : [e])), id: into.id };
}
