import { expect, test } from 'vitest'

import {
  EMPTY_RULE_SEARCH,
  createRuleSearchMatcher,
  normalizeDomain,
} from './rule-search'

const rule = (type: string) => ({ type })

test('content mode matches payloads case-insensitively and escapes regex', () => {
  const matcher = createRuleSearchMatcher({ mode: 'content', text: 'Example' })
  expect(matcher(rule('DomainSuffix'), 'example.com')).toBe(true)
  expect(matcher(rule('DomainSuffix'), 'other.org')).toBe(false)

  const literal = createRuleSearchMatcher({ mode: 'content', text: 'a.b' })
  expect(literal(rule('Domain'), 'a.b')).toBe(true)
  expect(literal(rule('Domain'), 'axb')).toBe(false)
})

test('domain mode respects rule types and normalizes URLs', () => {
  expect(normalizeDomain('https://Sub.Example.com:8443/path?q=1')).toBe(
    'sub.example.com',
  )

  const suffix = createRuleSearchMatcher({
    mode: 'domain',
    text: 'https://example.com/login',
  })
  expect(suffix(rule('DomainSuffix'), 'example.com')).toBe(true)
  expect(suffix(rule('DomainSuffix'), 'sub.example.com')).toBe(true)
  expect(suffix(rule('DomainSuffix'), 'otherexample.com')).toBe(false)

  const exact = createRuleSearchMatcher({
    mode: 'domain',
    text: 'example.com',
  })
  expect(exact(rule('Domain'), 'example.com')).toBe(true)
  expect(exact(rule('Domain'), 'sub.example.com')).toBe(false)

  expect(
    createRuleSearchMatcher({ mode: 'domain', text: 'ads' })(
      rule('DomainKeyword'),
      'adserver',
    ),
  ).toBe(true)
})

test('cidr mode matches overlapping ranges and IPv6', () => {
  const cidr = createRuleSearchMatcher({
    mode: 'cidr',
    text: '192.168.1.0/24',
  })
  expect(cidr(rule('IPCIDR'), '192.168.1.128/25')).toBe(true)
  expect(cidr(rule('IPCIDR'), '10.0.0.0/8')).toBe(false)
  expect(cidr(rule('DomainSuffix'), '192.168.1.0/24')).toBe(false)

  const ipv6 = createRuleSearchMatcher({
    mode: 'cidr',
    text: '2001:db8::1',
  })
  expect(ipv6(rule('IPCIDR'), '2001:db8::/32')).toBe(true)
})

test('empty search matches everything', () => {
  const matcher = createRuleSearchMatcher(EMPTY_RULE_SEARCH)
  expect(matcher(rule('Match'), '')).toBe(true)
  expect(matcher(rule('Domain'), 'anything')).toBe(true)
})
