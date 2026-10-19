import { Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import React, { ReactNode } from 'react'

import { startWindowDragging } from '@/utils/window-drag'

import { BaseErrorBoundary } from './base-error-boundary'

interface Props {
  title?: React.ReactNode // the page title
  header?: React.ReactNode // something behind title
  contentStyle?: React.CSSProperties
  children?: ReactNode
  full?: boolean
}

export const BasePage: React.FC<Props> = (props) => {
  const { title, header, contentStyle, full, children } = props
  const theme = useTheme()

  const isDark = theme.palette.mode === 'dark'

  return (
    <BaseErrorBoundary>
      <div className="base-page">
        <header
          onMouseDown={startWindowDragging}
          style={{ userSelect: 'none' }}
        >
          <Typography sx={{ fontSize: '20px', fontWeight: '700 ' }}>
            {title}
          </Typography>

          {header}
        </header>

        <div
          className={full ? 'base-container no-padding' : 'base-container'}
          style={{ backgroundColor: 'var(--surface-page)' }}
        >
          <section
            style={{
              backgroundColor: isDark
                ? 'var(--surface-page)'
                : 'var(--background-color)',
            }}
          >
            <div className="base-content" style={contentStyle}>
              {children}
            </div>
          </section>
        </div>
      </div>
    </BaseErrorBoundary>
  )
}
