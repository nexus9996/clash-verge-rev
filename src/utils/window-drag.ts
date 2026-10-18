import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

// Elements that keep their own click/selection behavior inside a drag region.
const INTERACTIVE_TARGETS = [
  'a',
  'button',
  'input',
  'label',
  'option',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[draggable="true"]',
  '[data-window-drag-ignore="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Treats the element as a title bar: drags the window from any non-interactive
 * area inside it and toggles maximize on double click. Tauri's
 * `data-tauri-drag-region` only reacts to clicks on the tagged element itself,
 * so compound regions such as page headers use this handler to keep their
 * children draggable as well.
 */
export const startWindowDragging = (event: MouseEvent<HTMLElement>) => {
  if (event.button !== 0 || (event.detail !== 1 && event.detail !== 2)) return

  const target = event.target
  if (!(target instanceof Element)) return
  // Events bubbling through portals (tooltips, menus) must not drag the window.
  if (!event.currentTarget.contains(target)) return
  if (target.closest(INTERACTIVE_TARGETS)) return
  if (window.getComputedStyle(target).cursor === 'pointer') return

  event.preventDefault()

  const currentWindow = getCurrentWindow()
  const action =
    event.detail === 2
      ? currentWindow.toggleMaximize()
      : currentWindow.startDragging()

  void action.catch((error) =>
    console.warn('[Window] 窗口拖动或缩放失败:', error),
  )
}
