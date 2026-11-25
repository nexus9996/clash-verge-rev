interface MixedPortSources {
  live?: number | null
  selected?: number | null
  merge?: number | null
}

const isValidPort = (port: number | null | undefined): port is number =>
  typeof port === 'number' &&
  Number.isInteger(port) &&
  port >= 1 &&
  port <= 65535

export const resolveDisplayedMixedPort = ({
  live,
  selected,
  merge,
}: MixedPortSources): number =>
  [live, selected, merge].find(isValidPort) ?? 7897
