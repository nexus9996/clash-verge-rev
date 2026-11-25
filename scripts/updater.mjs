import { context, getOctokit } from '@actions/github'

import { resolveUpdateLog, resolveUpdateLogDefault } from './updatelog.mjs'

const UPDATE_TAG_NAME = 'updater'
const UPDATE_JSON_FILE = 'update.json'
const UPDATE_JSON_PROXY = 'update-proxy.json'
const ALPHA_TAG_NAME = 'updater-alpha'
const ALPHA_UPDATE_JSON_FILE = 'update.json'
const ALPHA_UPDATE_JSON_PROXY = 'update-proxy.json'

// Tags that the updater can publish to the alpha channel: the updater parses
// `version` (or the legacy `name`) as semver, so the suffix must be a channel
// semver understands plus an optional numeric build.
const PRE_RELEASE_TAG_RE =
  /^v?(\d+)\.(\d+)\.(\d+)-(alpha|beta|pre|rc)(?:\.(\d+))?$/i
const CHANNEL_RANK = { alpha: 0, beta: 1, pre: 2, rc: 3 }

const parsePrereleaseTag = (tag) => {
  const match = PRE_RELEASE_TAG_RE.exec(tag)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: match[4].toLowerCase(),
    build: match[5] === undefined ? 0 : Number(match[5]),
  }
}

const comparePrereleaseTagsDesc = (leftTag, rightTag) => {
  const left = parsePrereleaseTag(leftTag)
  const right = parsePrereleaseTag(rightTag)
  return (
    right.major - left.major ||
    right.minor - left.minor ||
    right.patch - left.patch ||
    CHANNEL_RANK[right.channel] - CHANNEL_RANK[left.channel] ||
    right.build - left.build
  )
}

/**
 * Picks the release to publish on the alpha updater channel.
 *
 * The release workflow only flags `-rc` tags as `prerelease` on GitHub, so the
 * tag shape — not the release flag — decides the channel. Drafts are never
 * publishable. Alpha tags win when present so the alpha channel keeps
 * following alphas; otherwise the newest supported prerelease (beta/pre/rc)
 * is used. Returns `null` when no publishable prerelease exists so the caller
 * can skip explicitly instead of publishing a stale tag.
 */
export const selectNewestPrerelease = (releases) => {
  const candidates = releases.filter(
    (release) =>
      release.draft !== true && parsePrereleaseTag(release.tag_name) !== null,
  )
  if (candidates.length === 0) return null

  const alphaCandidates = candidates.filter(
    (release) => parsePrereleaseTag(release.tag_name).channel === 'alpha',
  )
  const pool = alphaCandidates.length > 0 ? alphaCandidates : candidates
  return [...pool].sort((left, right) =>
    comparePrereleaseTagsDesc(left.tag_name, right.tag_name),
  )[0]
}

async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required')
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo }
  const github = getOctokit(process.env.GITHUB_TOKEN)

  let allTags = []
  let page = 1
  const perPage = 100

  while (true) {
    const { data: pageTags } = await github.rest.repos.listTags({
      ...options,
      per_page: perPage,
      page: page,
    })

    allTags = allTags.concat(pageTags)

    if (pageTags.length < perPage) {
      break
    }

    page++
  }

  const tags = allTags
  console.log(`Retrieved ${tags.length} tags in total`)

  let allReleases = []
  page = 1
  while (true) {
    const { data: pageReleases } = await github.rest.repos.listReleases({
      ...options,
      per_page: perPage,
      page: page,
    })

    allReleases = allReleases.concat(pageReleases)

    if (pageReleases.length < perPage) {
      break
    }

    page++
  }

  const { data: latestRelease } =
    await github.rest.repos.getLatestRelease(options)
  const stableTag = { name: latestRelease.tag_name }
  const preRelease = selectNewestPrerelease(allReleases)
  const preReleaseTag = preRelease ? { name: preRelease.tag_name } : null

  console.log('All tags:', tags.map((t) => t.name).join(', '))
  console.log('Stable tag:', stableTag ? stableTag.name : 'None found')
  console.log(
    'Pre-release tag:',
    preReleaseTag ? preReleaseTag.name : 'None found',
  )
  console.log()

  if (stableTag) {
    await processRelease(github, options, stableTag, false)
  }

  if (preReleaseTag) {
    await processRelease(github, options, preReleaseTag, true)
  } else {
    // Publishing the alpha channel without a prerelease would either write
    // stale metadata or fail midway, so skip with an explicit message.
    console.warn(
      'No publishable alpha/prerelease found; skipping updater-alpha publish',
    )
  }
}

async function processRelease(github, options, tag, isAlpha) {
  if (!tag) return

  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({
      ...options,
      tag: tag.name,
    })

    const notes = await resolveUpdateLog(tag.name).catch(() =>
      resolveUpdateLogDefault().catch(() => 'No changelog available'),
    )
    const releaseUrl = `https://github.com/${options.owner}/${options.repo}/releases/tag/${tag.name}`

    const updateData = {
      name: tag.name,
      version: tag.name.replace(/^v/i, ''),
      notes: `${notes}\n\n**[See More](${releaseUrl})**`,
      pub_date: new Date().toISOString(),
      platforms: {
        // platform format:
        //    standard: "{os}-{arch}-{installer}",
        //    fallback: "{os}-{arch}"
        'darwin-x86_64': { signature: '', url: '' },
        'darwin-x86_64-app': { signature: '', url: '' },
        'darwin-aarch64': { signature: '', url: '' },
        'darwin-aarch64-app': { signature: '', url: '' },

        'linux-x86': { signature: '', url: '' },
        'linux-x86-deb': { signature: '', url: '' },
        'linux-x86-rpm': { signature: '', url: '' },
        'linux-x86_64': { signature: '', url: '' },
        'linux-x86_64-deb': { signature: '', url: '' },
        'linux-x86_64-rpm': { signature: '', url: '' },
        'linux-i686': { signature: '', url: '' },
        'linux-i686-deb': { signature: '', url: '' },
        'linux-i686-rpm': { signature: '', url: '' },
        'linux-aarch64': { signature: '', url: '' },
        'linux-aarch64-deb': { signature: '', url: '' },
        'linux-aarch64-rpm': { signature: '', url: '' },
        'linux-armv7': { signature: '', url: '' },
        'linux-armv7-deb': { signature: '', url: '' },
        'linux-armv7-rpm': { signature: '', url: '' },

        'windows-x86': { signature: '', url: '' },
        'windows-x86-nsis': { signature: '', url: '' },
        'windows-x86_64': { signature: '', url: '' },
        'windows-x86_64-nsis': { signature: '', url: '' },
        'windows-aarch64': { signature: '', url: '' },
        'windows-aarch64-nsis': { signature: '', url: '' },
        'windows-i686': { signature: '', url: '' },
        'windows-i686-nsis': { signature: '', url: '' },
      },
    }

    const promises = release.assets.map(async (asset) => {
      const { name, browser_download_url } = asset

      if (name.endsWith('x64-setup.exe')) {
        updateData.platforms['windows-x86_64'].url = browser_download_url
        updateData.platforms['windows-x86_64-nsis'].url = browser_download_url
      }
      if (name.endsWith('x64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-x86_64'].signature = sig
        updateData.platforms['windows-x86_64-nsis'].signature = sig
      }
      if (name.endsWith('x86-setup.exe')) {
        updateData.platforms['windows-x86'].url = browser_download_url
        updateData.platforms['windows-x86-nsis'].url = browser_download_url
        updateData.platforms['windows-i686-nsis'].url = browser_download_url
      }
      if (name.endsWith('x86-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-x86'].signature = sig
        updateData.platforms['windows-x86-nsis'].signature = sig
        updateData.platforms['windows-i686-nsis'].signature = sig
      }
      if (name.endsWith('arm64-setup.exe')) {
        updateData.platforms['windows-aarch64'].url = browser_download_url
        updateData.platforms['windows-aarch64-nsis'].url = browser_download_url
      }
      if (name.endsWith('arm64-setup.exe.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['windows-aarch64'].signature = sig
        updateData.platforms['windows-aarch64-nsis'].signature = sig
      }

      if (name.endsWith('.app.tar.gz') && !name.includes('aarch')) {
        updateData.platforms['darwin-x86_64'].url = browser_download_url
        updateData.platforms['darwin-x86_64-app'].url = browser_download_url
      }
      if (name.endsWith('.app.tar.gz.sig') && !name.includes('aarch')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['darwin-x86_64'].signature = sig
        updateData.platforms['darwin-x86_64-app'].signature = sig
      }
      if (name.endsWith('aarch64.app.tar.gz')) {
        updateData.platforms['darwin-aarch64'].url = browser_download_url
        updateData.platforms['darwin-aarch64-app'].url = browser_download_url
      }
      if (name.endsWith('aarch64.app.tar.gz.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['darwin-aarch64'].signature = sig
        updateData.platforms['darwin-aarch64-app'].signature = sig
      }

      if (name.endsWith('i386.deb')) {
        updateData.platforms['linux-x86'].url = browser_download_url
        updateData.platforms['linux-x86-deb'].url = browser_download_url
        updateData.platforms['linux-i686'].url = browser_download_url
        updateData.platforms['linux-i686-deb'].url = browser_download_url
      }
      if (name.endsWith('i386.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86'].signature = sig
        updateData.platforms['linux-x86-deb'].signature = sig
        updateData.platforms['linux-i686'].signature = sig
        updateData.platforms['linux-i686-deb'].signature = sig
      }
      if (name.endsWith('i386.rpm')) {
        updateData.platforms['linux-x86-rpm'].url = browser_download_url
        updateData.platforms['linux-i686-rpm'].url = browser_download_url
      }
      if (name.endsWith('i386.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86-rpm'].signature = sig
        updateData.platforms['linux-i686-rpm'].signature = sig
      }

      if (name.endsWith('amd64.deb')) {
        updateData.platforms['linux-x86_64'].url = browser_download_url
        updateData.platforms['linux-x86_64-deb'].url = browser_download_url
      }
      if (name.endsWith('amd64.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86_64'].signature = sig
        updateData.platforms['linux-x86_64-deb'].signature = sig
      }
      if (name.endsWith('x86_64.rpm')) {
        updateData.platforms['linux-x86_64-rpm'].url = browser_download_url
      }
      if (name.endsWith('x86_64.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-x86_64-rpm'].signature = sig
      }

      if (name.endsWith('arm64.deb')) {
        updateData.platforms['linux-aarch64'].url = browser_download_url
        updateData.platforms['linux-aarch64-deb'].url = browser_download_url
      }
      if (name.endsWith('arm64.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-aarch64'].signature = sig
        updateData.platforms['linux-aarch64-deb'].signature = sig
      }
      if (name.endsWith('aarch64.rpm')) {
        updateData.platforms['linux-aarch64-rpm'].url = browser_download_url
      }
      if (name.endsWith('aarch64.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-aarch64-rpm'].signature = sig
      }

      if (name.endsWith('armhf.deb')) {
        updateData.platforms['linux-armv7'].url = browser_download_url
        updateData.platforms['linux-armv7-deb'].url = browser_download_url
      }
      if (name.endsWith('armhf.deb.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-armv7'].signature = sig
        updateData.platforms['linux-armv7-deb'].signature = sig
      }
      if (name.endsWith('armhfp.rpm')) {
        updateData.platforms['linux-armv7-rpm'].url = browser_download_url
      }
      if (name.endsWith('armhfp.rpm.sig')) {
        const sig = await getSignature(browser_download_url)
        updateData.platforms['linux-armv7-rpm'].signature = sig
      }
    })

    await Promise.allSettled(promises)
    console.log(updateData)

    Object.entries(updateData.platforms).forEach(([key, value]) => {
      if (!value.url) {
        console.log(`[Error]: failed to parse release for "${key}"`)
        delete updateData.platforms[key]
      }
    })

    const updateDataNew = JSON.parse(JSON.stringify(updateData))

    Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
      if (value.url) {
        updateDataNew.platforms[key].url =
          `https://update.hwdns.net/${value.url}`
      } else {
        console.log(`[Error]: updateDataNew.platforms.${key} is null`)
      }
    })

    const releaseTag = isAlpha ? ALPHA_TAG_NAME : UPDATE_TAG_NAME
    console.log(
      `Processing ${isAlpha ? 'alpha' : 'stable'} release:`,
      releaseTag,
    )

    try {
      let updateRelease

      try {
        const response = await github.rest.repos.getReleaseByTag({
          ...options,
          tag: releaseTag,
        })
        updateRelease = response.data
        console.log(
          `Found existing ${releaseTag} release with ID: ${updateRelease.id}`,
        )
      } catch (error) {
        if (error.status === 404) {
          console.log(
            `Release with tag ${releaseTag} not found, creating new release...`,
          )
          const createResponse = await github.rest.repos.createRelease({
            ...options,
            tag_name: releaseTag,
            name: isAlpha
              ? 'Auto-update Alpha Channel'
              : 'Auto-update Stable Channel',
            body: `This release contains the update information for ${isAlpha ? 'alpha' : 'stable'} channel.`,
            prerelease: isAlpha,
          })
          updateRelease = createResponse.data
          console.log(
            `Created new ${releaseTag} release with ID: ${updateRelease.id}`,
          )
        } else {
          throw error
        }
      }

      const jsonFile = isAlpha ? ALPHA_UPDATE_JSON_FILE : UPDATE_JSON_FILE
      const proxyFile = isAlpha ? ALPHA_UPDATE_JSON_PROXY : UPDATE_JSON_PROXY

      for (const asset of updateRelease.assets) {
        if (asset.name === jsonFile) {
          await github.rest.repos.deleteReleaseAsset({
            ...options,
            asset_id: asset.id,
          })
        }

        if (asset.name === proxyFile) {
          await github.rest.repos
            .deleteReleaseAsset({ ...options, asset_id: asset.id })
            .catch(console.error) // do not break the pipeline
        }
      }

      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: jsonFile,
        data: JSON.stringify(updateData, null, 2),
      })

      await github.rest.repos.uploadReleaseAsset({
        ...options,
        release_id: updateRelease.id,
        name: proxyFile,
        data: JSON.stringify(updateDataNew, null, 2),
      })

      console.log(
        `Successfully uploaded ${isAlpha ? 'alpha' : 'stable'} update files to ${releaseTag}`,
      )
    } catch (error) {
      console.error(
        `Failed to process ${isAlpha ? 'alpha' : 'stable'} release:`,
        error.message,
      )
    }
  } catch (error) {
    if (error.status === 404) {
      console.log(`Release not found for tag: ${tag.name}, skipping...`)
    } else {
      console.error(`Failed to get release for tag: ${tag.name}`, error.message)
    }
  }
}

async function getSignature(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/octet-stream' },
  })

  return response.text()
}

// Only run when executed directly; tests import the helpers above.
if (import.meta.main) {
  resolveUpdater().catch(console.error)
}
