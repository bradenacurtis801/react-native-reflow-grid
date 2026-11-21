/** A tab: a made-up page, with the title and host Safari shows for it. */
export interface Tab {
  id: number;
  title: string;
  host: string;
  hue: number;
  /** A page on a dark ground, as many sites are. */
  dark: boolean;
}

const SITES: [title: string, host: string][] = [
  ['Northwind Weather: today and the week', 'northwind.example'],
  ['Field notes on setting type', 'fieldnotes.example'],
  ['Pasta, slowly: a patient guide', 'slowpasta.example'],
  ['Trail conditions near the ridge', 'ridgewatch.example'],
  ['A short history of the lighthouse', 'lamplight.example'],
  ['Compare compact cameras', 'lensbench.example'],
  ['Game night: room ZFJG', 'gamenight.example'],
  ['Notes on spring animation', 'springs.example'],
  ['Single room for rent, near transit', 'roomfinder.example'],
  ['The cheese board atlas', 'cheeseatlas.example'],
  ['Star charts for this month', 'nightsky.example'],
  ['Learn the ukulele in a week', 'strumday.example'],
  ['Marathon training, week by week', 'longrun.example'],
  ['A field guide to mushrooms', 'sporeguide.example'],
];

/** `count` tabs, numbered from `from`. */
export const makeTabs = (from: number, count: number): Tab[] =>
  Array.from({ length: count }, (_, i) => {
    const id = from + i;
    const [title, host] = SITES[(id - 1) % SITES.length]!;
    return { id, title, host, hue: (id * 47) % 360, dark: id % 3 === 0 };
  });
