import { EditRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import {
  type ChangeEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { EditorViewer } from '@/components/profile/editor-viewer'
import { ThemeColorSelect } from '@/components/setting/mods/theme-color-select'
import {
  defaultDarkTheme,
  defaultTheme,
  THEME_PRESETS,
  type ThemePresetColorKey,
  type ThemePreset,
  type ThemePresetId,
} from '@/config/theme'
import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

type EditMode = 'light' | 'dark'
type ThemeSetting = NonNullable<IVergeConfig['theme_setting']>
type ThemeSettingColorKey =
  | ThemePresetColorKey
  | 'background_color'
  | 'paper_background_color'

export function ThemeViewer(props: { ref?: React.Ref<DialogRef> }) {
  const { ref } = props
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [cssEditorValue, setCssEditorValue] = useState('')
  const [cssEditorSavedValue, setCssEditorSavedValue] = useState('')
  const { palette } = useTheme()
  const { verge, patchVerge } = useVerge()
  const { theme_setting, light_theme_setting, dark_theme_setting } = verge ?? {}
  const [editMode, setEditMode] = useState<EditMode>('light')
  const [theme, setTheme] = useState<ThemeSetting>(() => theme_setting ?? {})

  const themeSettingFor = (mode: EditMode): ThemeSetting =>
    (mode === 'light' ? light_theme_setting : dark_theme_setting) ??
    theme_setting ??
    {}
  // Latest theme ref to avoid stale closures when saving CSS
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  useImperativeHandle(ref, () => ({
    open: () => {
      const nextMode: EditMode = palette.mode === 'dark' ? 'dark' : 'light'
      setEditMode(nextMode)
      setTheme(themeSettingFor(nextMode))
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const textProps = {
    size: 'small',
    autoComplete: 'off',
    sx: { width: 135 },
  } as const

  const handleFontFamilyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTheme((prev) => ({ ...prev, font_family: event.target.value }))
  }

  const handleColorChange = (key: ThemeSettingColorKey) => (value: string) => {
    setTheme((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const onSave = useLockFn(async () => {
    try {
      await patchVerge(
        editMode === 'light'
          ? { light_theme_setting: theme }
          : { dark_theme_setting: theme },
      )
      setOpen(false)
    } catch (err) {
      showNotice.error(err)
    }
  })

  const dt = editMode === 'light' ? defaultTheme : defaultDarkTheme

  const fieldDefinitions: Array<{
    labelKey: string
    key: ThemePresetColorKey
  }> = useMemo(
    () => [
      {
        labelKey: 'settings.components.verge.theme.fields.primaryColor',
        key: 'primary_color',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.secondaryColor',
        key: 'secondary_color',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.primaryText',
        key: 'primary_text',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.secondaryText',
        key: 'secondary_text',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.infoColor',
        key: 'info_color',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.warningColor',
        key: 'warning_color',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.errorColor',
        key: 'error_color',
      },
      {
        labelKey: 'settings.components.verge.theme.fields.successColor',
        key: 'success_color',
      },
    ],
    [],
  )

  const openCssEditor = () => {
    const nextCss = themeRef.current?.css_injection ?? ''
    setCssEditorValue(nextCss)
    setCssEditorSavedValue(nextCss)
    setEditorOpen(true)
  }

  const handleSaveCss = useLockFn(async () => {
    const prevTheme = themeRef.current || {}
    setTheme({ ...prevTheme, css_injection: cssEditorValue })
    setCssEditorSavedValue(cssEditorValue)
  })

  const presetNames = useMemo<Record<ThemePresetId, string>>(
    () => ({
      default: t('settings.components.verge.theme.presets.names.default'),
      ocean: t('settings.components.verge.theme.presets.names.ocean'),
      indigo: t('settings.components.verge.theme.presets.names.indigo'),
      sunset: t('settings.components.verge.theme.presets.names.sunset'),
      lavender: t('settings.components.verge.theme.presets.names.lavender'),
      monochrome: t('settings.components.verge.theme.presets.names.monochrome'),
    }),
    [t],
  )

  const applyPreset = (preset: ThemePreset) => {
    const colors = editMode === 'light' ? preset.light : preset.dark
    setTheme((prev) => ({ ...prev, ...colors }))
  }

  const selectEditMode = (_event: unknown, value: EditMode | null) => {
    if (!value || value === editMode) return
    setEditMode(value)
    setTheme(themeSettingFor(value))
  }

  const renderEditModes = () => (
    <Item>
      <ListItemText
        primary={t('settings.components.verge.theme.editModes.title')}
      />
      <ToggleButtonGroup
        exclusive
        color="primary"
        size="small"
        value={editMode}
        onChange={selectEditMode}
      >
        <ToggleButton value="light">
          {t('settings.components.verge.theme.editModes.light')}
        </ToggleButton>
        <ToggleButton value="dark">
          {t('settings.components.verge.theme.editModes.dark')}
        </ToggleButton>
      </ToggleButtonGroup>
    </Item>
  )

  const renderItem = (labelKey: string, key: ThemePresetColorKey) => (
    <ThemeColorSelect
      key={key}
      label={t(labelKey)}
      value={theme[key]}
      defaultValue={dt[key]}
      onChange={handleColorChange(key)}
    />
  )

  const renderPresets = () => (
    <Item>
      <ListItemText
        primary={t('settings.components.verge.theme.presets.title')}
      />
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          justifyContent: 'flex-end',
          maxWidth: 230,
        }}
      >
        {THEME_PRESETS.map((preset) => {
          const colors = editMode === 'light' ? preset.light : preset.dark
          return (
            <Button
              key={preset.id}
              size="small"
              variant="outlined"
              onClick={() => applyPreset(preset)}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 12,
                textTransform: 'none',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 12,
                  height: 12,
                  mr: 0.5,
                  borderRadius: '50%',
                  bgcolor: colors.primary_color,
                  flexShrink: 0,
                }}
              />
              {presetNames[preset.id]}
            </Button>
          )
        })}
      </Box>
    </Item>
  )

  return (
    <BaseDialog
      open={open}
      title={t('settings.components.verge.theme.title')}
      okBtn={t('shared.actions.save')}
      cancelBtn={t('shared.actions.cancel')}
      contentSx={{ width: 400, maxHeight: 505, overflow: 'auto', pb: 0 }}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List sx={{ pt: 0 }}>
        {renderPresets()}
        {renderEditModes()}
        {fieldDefinitions.map((field) => renderItem(field.labelKey, field.key))}
        <ThemeColorSelect
          label={t('settings.components.verge.theme.fields.background')}
          value={theme.background_color}
          defaultValue={dt.background_color}
          onChange={handleColorChange('background_color')}
        />
        <ThemeColorSelect
          label={t('settings.components.verge.theme.fields.paperBackground')}
          value={theme.paper_background_color}
          defaultValue={dt.background_color}
          onChange={handleColorChange('paper_background_color')}
        />

        <Item>
          <ListItemText
            primary={t('settings.components.verge.theme.fields.fontFamily')}
          />
          <TextField
            {...textProps}
            value={theme.font_family ?? ''}
            onChange={handleFontFamilyChange}
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
          />
        </Item>
        <Item>
          <ListItemText
            primary={t('settings.components.verge.theme.fields.cssInjection')}
          />
          <Button
            startIcon={<EditRounded />}
            variant="outlined"
            onClick={openCssEditor}
          >
            {t('settings.components.verge.theme.actions.editCss')}
          </Button>
          {editorOpen && (
            <EditorViewer
              open={true}
              title={t('settings.components.verge.theme.dialogs.editCssTitle')}
              value={cssEditorValue}
              language="css"
              path="theme-css.css"
              dirty={cssEditorValue !== cssEditorSavedValue}
              onChange={setCssEditorValue}
              onSave={handleSaveCss}
              onClose={() => {
                setEditorOpen(false)
              }}
            />
          )}
        </Item>
      </List>
    </BaseDialog>
  )
}

const Item = styled(ListItem)(() => ({
  padding: '5px 2px',
}))
