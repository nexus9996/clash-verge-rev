/**
 * Pure TUN dialog helpers, kept out of the viewer so the save/reset payload can
 * be unit tested without mounting MUI or the clash hooks.
 */
export interface TunFormValues {
  stack: string
  device: string
  autoRoute: boolean
  routeExcludeAddress: string
  autoRedirect: boolean
  autoDetectInterface: boolean
  dnsHijack: string[]
  strictRoute: boolean
  mtu: number
  dnsMode: string
}

export const splitRouteExcludeAddress = (value: string) =>
  value
    .split(/[,\n;\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)

/** Defaults shared by the initial form state and the reset button. */
export const defaultTunFormValues = (os: string): TunFormValues => ({
  stack: 'mips',
  device: os === 'macos' ? 'utun1024' : 'Mihomo',
  autoRoute: true,
  routeExcludeAddress: '',
  autoRedirect: false,
  autoDetectInterface: true,
  dnsHijack: ['any:53'],
  strictRoute: false,
  mtu: 1500,
  dnsMode: '',
})

/** Wire payload written by both the save and reset paths of the dialog. */
export const buildTunConfig = (
  values: TunFormValues,
  os: string,
): IConfigData['tun'] => ({
  stack: values.stack,
  device:
    values.device === ''
      ? os === 'macos'
        ? 'utun1024'
        : 'Mihomo'
      : values.device,
  'auto-route': values.autoRoute,
  'route-exclude-address': splitRouteExcludeAddress(values.routeExcludeAddress),
  ...(os === 'linux'
    ? {
        'auto-redirect': values.autoRedirect,
      }
    : {}),
  'auto-detect-interface': values.autoDetectInterface,
  'dns-hijack': values.dnsHijack[0] === '' ? [] : values.dnsHijack,
  'dns-mode': values.dnsMode,
  'strict-route': values.strictRoute,
  mtu: values.mtu ?? 1500,
})
