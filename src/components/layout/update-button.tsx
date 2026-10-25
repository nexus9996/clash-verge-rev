import { Button } from '@mui/material'
import { lazy, Suspense, useRef } from 'react'

import { DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'

const LazyUpdateViewer = lazy(() =>
  import('../setting/mods/update-viewer').then((module) => ({
    default: module.UpdateViewer,
  })),
)

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const viewerRef = useRef<DialogRef>(null)

  const { updateInfo } = useUpdate()

  if (!updateInfo?.available) return null

  return (
    <>
      <Suspense fallback={null}>
        <LazyUpdateViewer ref={viewerRef} />
      </Suspense>

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open()}
      >
        New
      </Button>
    </>
  )
}
