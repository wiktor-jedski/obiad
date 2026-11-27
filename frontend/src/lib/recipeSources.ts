/** Recipe websites listed on the Sources page. */
export const recipeSources = [
  ["Kuchnia Domowa", "https://kuchnia-domowa.pl/"],
  ["TheMealDB", "https://www.themealdb.com/"],
  [
    "Wikibooks Cookbook",
    "https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents",
  ],
] as const;

const namesByHost = new Map<string, string>(
  recipeSources.map(([name, url]) => [new URL(url).hostname, name]),
);

/** Return the website name, or the hostname for an unlisted source. */
export function recipeSiteName(source: URL): string {
  return namesByHost.get(source.hostname) ?? source.hostname;
}
