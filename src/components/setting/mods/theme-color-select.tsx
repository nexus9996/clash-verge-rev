import { Box, ListItem, ListItemText, TextField } from '@mui/material'
import { type ChangeEvent, useState } from 'react'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

interface Props {
  label: string
  value?: string | null
  defaultValue: string
  onChange: (value: string) => void
}

export function ThemeColorSelect(props: Props) {
  const { label, value, defaultValue, onChange } = props
  const [text, setText] = useState(value ?? '')
  const [previousValue, setPreviousValue] = useState(value)

  // Adjust local text when the parent value changes (for example, a preset is applied).
  if (value !== previousValue) {
    setPreviousValue(value)
    setText(value ?? '')
  }

  const swatchColor = HEX_COLOR.test(text) ? text : defaultValue

  const handleTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    setText(next)
    if (next === '') {
      onChange('')
    } else if (HEX_COLOR.test(next)) {
      onChange(next)
    }
  }

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    setText(next)
    onChange(next)
  }

  return (
    <ListItem sx={{ padding: '5px 2px' }}>
      <ListItemText primary={label} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          sx={{
            position: 'relative',
            width: 28,
            height: 28,
            borderRadius: '8px',
            border: '2px solid',
            borderColor: 'divider',
            bgcolor: swatchColor,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <input
            type="color"
            value={swatchColor}
            aria-label={label}
            onChange={handlePickerChange}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              padding: 0,
              border: 0,
              opacity: 0,
              cursor: 'pointer',
            }}
          />
        </Box>
        <TextField
          size="small"
          autoComplete="off"
          spellCheck="false"
          value={text}
          placeholder={defaultValue}
          onChange={handleTextChange}
          sx={{
            width: 108,
            '& input': { fontSize: 12 },
          }}
          slotProps={{ htmlInput: { maxLength: 7 } }}
        />
      </Box>
    </ListItem>
  )
}
