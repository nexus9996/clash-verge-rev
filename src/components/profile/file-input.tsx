import { Box, Button, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import { type ChangeEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onChange: (file: File, value: string) => void
}

export const FileInput = (props: Props) => {
  const { onChange } = props

  const { t } = useTranslation()
  // file input
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState('')

  const onFileInput = useLockFn(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]

    if (!file) return

    setFileName(file.name)
    setLoading(true)

    try {
      await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (event) => {
          resolve(null)
          onChange(file, event.target?.result as string)
        }
        reader.onerror = reject
        reader.readAsText(file)
      })
    } finally {
      setLoading(false)
      // Allow selecting the same file again: the input only fires change when
      // its value differs from the previous selection.
      e.target.value = ''
    }
  })

  return (
    <Box sx={{ mt: 2, mb: 1, display: 'flex', alignItems: 'center' }}>
      <Button
        variant="outlined"
        sx={{ flex: 'none' }}
        onClick={() => inputRef.current?.click()}
      >
        {t('profiles.components.fileInput.chooseFile')}
      </Button>

      <input
        type="file"
        accept=".yaml,.yml"
        ref={inputRef}
        style={{ display: 'none' }}
        onChange={onFileInput}
      />

      <Typography noWrap sx={{ ml: 1 }}>
        {loading ? t('shared.statuses.loading') : fileName}
      </Typography>
    </Box>
  )
}
