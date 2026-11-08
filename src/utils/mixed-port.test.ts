import { expect, test } from 'vitest'

import { resolveDisplayedMixedPort } from './mixed-port'

test('prefers the live config, then the selected port, then the merged config', () => {
  expect(
    resolveDisplayedMixedPort({ live: 7890, selected: 7891, merge: 7892 }),
  ).toBe(7890)
  expect(resolveDisplayedMixedPort({ selected: 7891, merge: 7892 })).toBe(7891)
  expect(resolveDisplayedMixedPort({ merge: 7892 })).toBe(7892)
})

test('ignores out-of-range and missing sources', () => {
  expect(
    resolveDisplayedMixedPort({
      live: 0,
      selected: 70_000,
      merge: 7892,
    }),
  ).toBe(7892)
  expect(resolveDisplayedMixedPort({})).toBe(7897)
})
