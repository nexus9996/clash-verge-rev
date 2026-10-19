export type ConnectionFilterField =
  | 'host'
  | 'destinationIP'
  | 'destinationPort'
  | 'network'
  | 'type'
  | 'process'
  | 'rule'
  | 'chains'
  | 'sourceIP'
  | 'sourcePort'
  | 'remoteDestination'

/**
 * The connection shape needed by the filter. Kept structural so the matcher can
 * be unit-tested without loading the Tauri runtime, and so both the live and
 * closed connection lists can be filtered by the same code.
 */
export interface FilterableConnection {
  metadata: {
    host: string
    destinationIP?: string
    destinationPort: string
    network: string
    type: string
    process?: string
    processPath?: string
    sourceIP: string
    sourcePort: string
    remoteDestination?: string
  }
  rule: string
  rulePayload: string
  chains: string[]
}

export interface ConnectionFilter {
  field: ConnectionFilterField
  value: string
}

const compactValues = (values: Array<string | undefined>): string[] => {
  const result: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) result.push(trimmed)
  }
  return result
}

const formatRule = (connection: FilterableConnection) => {
  const { rule, rulePayload } = connection
  return rulePayload ? `${rule}(${rulePayload})` : rule
}

const formatChains = (chains: string[]) => {
  if (!chains.length) return []
  return [[...chains].reverse().join(' / ')]
}

const getFieldValues = (
  field: ConnectionFilterField,
  connection: FilterableConnection,
): string[] => {
  const { metadata } = connection
  switch (field) {
    case 'host': {
      const host = metadata.host || metadata.destinationIP
      return host ? [`${host}:${metadata.destinationPort}`] : []
    }
    case 'destinationIP':
      return compactValues([metadata.destinationIP])
    case 'destinationPort':
      return compactValues([metadata.destinationPort])
    case 'network':
      return compactValues([metadata.network])
    case 'type':
      return compactValues([metadata.type])
    case 'process':
      return compactValues([metadata.process, metadata.processPath])
    case 'rule':
      return compactValues([formatRule(connection)])
    case 'chains':
      return compactValues(formatChains(connection.chains))
    case 'sourceIP':
      return compactValues([metadata.sourceIP])
    case 'sourcePort':
      return compactValues([metadata.sourcePort])
    case 'remoteDestination':
      return compactValues([metadata.remoteDestination])
    default:
      return []
  }
}

export const CONNECTION_FILTER_FIELDS: readonly ConnectionFilterField[] = [
  'host',
  'sourceIP',
  'sourcePort',
  'destinationIP',
  'destinationPort',
  'remoteDestination',
  'network',
  'type',
  'process',
  'rule',
  'chains',
]

export const getConnectionFilterKey = ({ field, value }: ConnectionFilter) =>
  `${field}\u0000${value}`

export const getConnectionFieldValues = (
  field: ConnectionFilterField,
  connection: FilterableConnection,
): string[] => getFieldValues(field, connection)

/**
 * Builds a predicate over connections. Multiple values of the same field are
 * OR-ed, different fields are AND-ed; a connection matches when every active
 * field has at least one matching value.
 */
export const createConnectionFilterMatcher = (
  filters: readonly ConnectionFilter[],
  excludedField?: ConnectionFilterField,
) => {
  const activeFilters = excludedField
    ? filters.filter((filter) => filter.field !== excludedField)
    : filters

  if (activeFilters.length === 0) return () => true

  const valuesByField = new Map<ConnectionFilterField, Set<string>>()
  for (const { field, value } of activeFilters) {
    const values = valuesByField.get(field) ?? new Set<string>()
    values.add(value.toLowerCase())
    valuesByField.set(field, values)
  }

  const matchers = [...valuesByField].map(([field, values]) => ({
    field,
    values,
  }))

  return (connection: FilterableConnection) =>
    matchers.every(({ field, values }) =>
      getFieldValues(field, connection).some((value) =>
        values.has(value.toLowerCase()),
      ),
    )
}
