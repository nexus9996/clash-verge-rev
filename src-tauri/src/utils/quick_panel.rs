use crate::core::handle;
use anyhow::{Result, anyhow};
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{NSApplication, NSPopover, NSPopoverBehavior, NSView, NSViewController};
use objc2_foundation::{NSRectEdge, NSSize, ns_string};
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager as _, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "quick-panel";
const WIDTH: f64 = 520.0;
const INITIAL_HEIGHT: f64 = 620.0;

/// Explicit opt-in switch (enable_quick_panel, default off). While it is off the
/// tray keeps its native right-click menu and no panel window is created.
static ENABLED: AtomicBool = AtomicBool::new(false);

thread_local! {
    static POPOVER: RefCell<Option<Retained<NSPopover>>> = const { RefCell::new(None) };
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Store the switch without touching AppKit. Used while the tray is being built.
pub fn set_enabled_cached(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// Apply the opt-in switch to the macOS tray. Called from the Verge effect registry
/// and safe to call from the async runtime (the AppKit part runs on the main thread).
pub fn apply_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    let app = handle::Handle::app_handle();
    let Some(tray) = app.tray_by_id(crate::core::tray::TRAY_ID) else {
        return;
    };
    let _ = tray.with_inner_blocking(move |inner| {
        inner.set_show_menu_on_right_click(!enabled);
    });
    if !enabled {
        close();
    }
}

/// Close the panel if it is currently shown.
pub fn close() {
    let app = handle::Handle::app_handle();
    let Some(tray) = app.tray_by_id(crate::core::tray::TRAY_ID) else {
        return;
    };
    let _ = tray.with_inner_blocking(|_| {
        POPOVER.with(|slot| {
            if let Some(popover) = slot.borrow().as_ref() {
                popover.close();
            }
        });
    });
}

pub fn toggle() -> Result<()> {
    if !is_enabled() {
        return Ok(());
    }
    toggle_for(
        handle::Handle::app_handle(),
        crate::core::tray::TRAY_ID,
        "quick-panel-live.html",
    )
}

/// The hidden Tauri window owns IPC and the webview; AppKit presents its view.
pub fn toggle_for(app: &AppHandle, tray_id: &str, page: &str) -> Result<()> {
    let (window, rebuilt) = match app.get_webview_window(LABEL) {
        Some(window) => (window, false),
        None => (
            WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(page.into()))
                .title("Clash Verge")
                .inner_size(WIDTH, INITIAL_HEIGHT)
                .decorations(false)
                .resizable(false)
                .skip_taskbar(true)
                .visible(false)
                .build()?,
            true,
        ),
    };
    // Move only WKWebView. Tao must retain its own content view for window events.
    let (sender, receiver) = std::sync::mpsc::channel();
    window.with_webview(move |webview| {
        if let Some(webview) = webview.downcast_ref::<tauri_runtime_wry::Webview>() {
            let _ = sender.send(webview.inner() as usize);
        }
    })?;
    let view_address = receiver.recv()?;
    let tray = app.tray_by_id(tray_id).ok_or_else(|| anyhow!("Tray is unavailable"))?;
    tray.with_inner_blocking(move |inner| -> Result<()> {
        let mtm = MainThreadMarker::new().ok_or_else(|| anyhow!("Popover requires the main thread"))?;
        let item = inner
            .ns_status_item()
            .ok_or_else(|| anyhow!("Status item is unavailable"))?;
        let button = item
            .button(mtm)
            .ok_or_else(|| anyhow!("Status button is unavailable"))?;
        POPOVER.with(|slot| {
            let mut slot = slot.borrow_mut();
            // The cached popover holds a pointer into the host window's WKWebView.
            // Dropping it when the window was rebuilt avoids presenting a dead view.
            if rebuilt {
                *slot = None;
            }
            if let Some(popover) = slot.as_ref()
                && popover.isShown()
            {
                popover.close();
                return;
            }
            let popover = slot.get_or_insert_with(|| {
                let popover = NSPopover::new(mtm);
                let controller = NSViewController::new(mtm);
                // Wry retains WKWebView for the lifetime of the hidden host window.
                let view = unsafe { &*(view_address as *const NSView) };
                view.removeFromSuperview();
                controller.setView(view);
                popover.setContentViewController(Some(&controller));
                popover.setContentSize(NSSize::new(WIDTH, INITIAL_HEIGHT));
                popover.setBehavior(NSPopoverBehavior::Transient);
                popover.setAnimates(true);
                popover
            });
            // Compatible with macOS versions predating cooperative activation.
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            popover.showRelativeToRect_ofView_preferredEdge(button.bounds(), &button, NSRectEdge::MinY);
            if let Some(view) = popover.contentViewController().map(|controller| controller.view())
                && let Some(window) = view.window()
            {
                window.setTitle(ns_string!("Clash Verge"));
                window.makeKeyWindow();
                window.makeFirstResponder(Some(&view));
            }
        });
        Ok(())
    })??;
    Ok(())
}

pub fn state(app: &AppHandle, tray_id: &str, height: Option<f64>, close: bool) -> Result<bool> {
    let tray = app.tray_by_id(tray_id).ok_or_else(|| anyhow!("Tray is unavailable"))?;
    Ok(tray.with_inner_blocking(move |_| {
        POPOVER.with(|slot| {
            let slot = slot.borrow();
            let Some(popover) = slot.as_ref() else {
                return false;
            };
            if close {
                popover.close();
            } else if let Some(height) = height.filter(|height| height.is_finite()) {
                popover.setContentSize(NSSize::new(WIDTH, height.clamp(200.0, 760.0)));
            }
            popover.isShown()
        })
    })?)
}
