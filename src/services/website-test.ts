import { cmdTestDelay } from './cmds'

const MAX_CONCURRENT = 3

let active = 0
const waiting: Array<() => void> = []

const acquire = () =>
  new Promise<void>((resolve) => {
    if (active < MAX_CONCURRENT) {
      active += 1
      resolve()
      return
    }
    waiting.push(resolve)
  })

const release = () => {
  const next = waiting.shift()
  if (next) next()
  else active -= 1
}

/** Queued website probes keep "test all" from opening one connection per row. */
export async function testWebsiteDelayQueued(url: string) {
  await acquire()
  try {
    return await cmdTestDelay(url)
  } finally {
    release()
  }
}
