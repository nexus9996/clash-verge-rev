use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::Manager as _;
use tauri::utils::config::Color;
use tauri::webview::PageLoadEvent;
use tauri::{Theme, WebviewWindow};

use crate::{config::Config, core::handle, utils::resolve::window_script::build_window_initial_script};
#[cfg(target_os = "macos")]
use clash_verge_logging::logging;
use clash_verge_logging::{Type, logging_error};

const DARK_BACKGROUND_COLOR: Color = Color(46, 48, 61, 255); // #2E303D
const LIGHT_BACKGROUND_COLOR: Color = Color(245, 245, 245, 255); // #F5F5F5
const DARK_BACKGROUND_HEX: &str = "#2E303D";
const LIGHT_BACKGROUND_HEX: &str = "#F5F5F5";

const DEFAULT_WIDTH: f64 = 940.0;
const DEFAULT_HEIGHT: f64 = 700.0;

const MINIMAL_WIDTH: f64 = 520.0;
const MINIMAL_HEIGHT: f64 = 520.0;

pub fn set_native_window_theme(window: WebviewWindow, theme: &str) -> Result<(), String> {
    let background_color = match theme {
        "dark" => DARK_BACKGROUND_COLOR,
        "light" => LIGHT_BACKGROUND_COLOR,
        _ => return Err(format!("unsupported theme: {theme}")),
    };

    window
        .set_background_color(Some(background_color))
        .map_err(|error| error.to_string())
}

const fn restored_window_size_is_too_small(width: u32, height: u32) -> bool {
    width < MINIMAL_WIDTH as u32 || height < MINIMAL_HEIGHT as u32
}

fn restore_default_size_if_needed(window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else {
        return;
    };

    if !restored_window_size_is_too_small(size.width, size.height) {
        return;
    }

    logging_error!(
        Type::Window,
        window.set_size(tauri::LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT))
    );
    logging_error!(Type::Window, window.center());
}

pub async fn build_new_window() -> Result<WebviewWindow, String> {
    let app_handle = handle::Handle::app_handle();

    let config = Config::verge().await;
    let latest = config.latest_arc();
    let decorations = latest.enable_system_titlebar.unwrap_or(true);
    let start_page = latest.start_page.as_deref().unwrap_or("/");
    let initial_theme_mode = match latest.theme_mode.as_deref() {
        Some("dark") => "dark",
        Some("light") => "light",
        _ => "system",
    };

    let resolved_theme = match initial_theme_mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };

    let prefers_dark_background = match resolved_theme {
        Some(Theme::Dark) => true,
        Some(Theme::Light) => false,
        _ => !matches!(detect_system_theme().ok(), Some(SystemTheme::Light)),
    };

    let background_color = if prefers_dark_background {
        DARK_BACKGROUND_COLOR
    } else {
        LIGHT_BACKGROUND_COLOR
    };

    let initial_script = build_window_initial_script(initial_theme_mode, DARK_BACKGROUND_HEX, LIGHT_BACKGROUND_HEX);

    // 首次页面加载是否已经执行过提前 show。只让首次加载在 Started 显示，后续导航（含渲染
    // 进程被终止后的恢复 reload）仍走 Finished 逻辑。
    let first_load_shown = std::sync::atomic::AtomicBool::new(false);

    let mut builder = tauri::WebviewWindowBuilder::new(
        app_handle,
        "main", /* the unique window label */
        tauri::WebviewUrl::App(start_page.into()),
    )
    .title("Clash Verge")
    .center()
    .decorations(decorations)
    .fullscreen(false)
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .min_inner_size(MINIMAL_WIDTH, MINIMAL_HEIGHT)
    .visible(false) // 隐藏创建，待首个 PageLoadEvent::Started 显示；原生背景色已就绪，不会白闪
    .initialization_script(&initial_script)
    .general_autofill_enabled(false) // 禁用自动填充
    .on_page_load(move |window, payload| {
        match payload.event() {
            // 首个 Started 就显示：builder.background_color / set_background_color 已按初始主题
            // 设置原生背景色，提前显示不会白闪，只会让用户短暂看到主题色空窗，窗口可见时间
            // 由此提前“Started -> Finished”的页面加载耗时，这也是本次改动的唯一真实风险。
            // 重复 show() 幂等；只让首次加载提前，是因为渲染进程被系统终止后的恢复 reload
            //（见 WindowManager::activate_window 的 defer_show_to_page_load）要等 Finished 后
            // 再显示才不白闪，dev/HMR 的后续导航也保持原有 Finished 行为。
            // A/B 验证：同一构建分别还原/应用本改动各启动一次，录屏逐帧或 probe 记录 window_ms，
            // 对比窗口可见时间戳与主题色空窗时长。
            PageLoadEvent::Started => {
                if !first_load_shown.swap(true, std::sync::atomic::Ordering::AcqRel) {
                    logging_error!(Type::Window, window.show());
                }
            }
            // 首次加载时 show 已是 no-op；恢复 reload 依赖这里再次 show。焦点仍等页面
            // Finished 后再设置，避免为空窗抢焦点，也与原有焦点时机保持一致。
            PageLoadEvent::Finished => {
                logging_error!(Type::Window, window.show());
                logging_error!(Type::Window, window.set_focus());
            }
        }
    });

    #[cfg(target_os = "macos")]
    {
        // macOS draws its native traffic lights over an overlay title bar,
        // so the webview fills the whole window without a separate title strip.
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    builder = builder.background_color(background_color);

    match builder.build() {
        Ok(window) => {
            logging_error!(Type::Window, window.set_background_color(Some(background_color)));
            restore_default_size_if_needed(&window);
            #[cfg(target_os = "macos")]
            keep_window_on_active_space(&window);
            // A new page supersedes any reload marker left by the old window.
            #[cfg(target_os = "macos")]
            take_webview_needs_reload();
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// AppKit allows at most one of `CanJoinAllSpaces` and `MoveToActiveSpace`, so the former is
/// dropped rather than left in place as a second, conflicting flag. Every other behavior the
/// window already carries is preserved.
#[cfg(target_os = "macos")]
const fn active_space_collection_behavior(
    current: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior;

    current
        .difference(NSWindowCollectionBehavior::CanJoinAllSpaces)
        .union(NSWindowCollectionBehavior::MoveToActiveSpace)
}

/// Shows the main window on whichever Space the user is looking at.
///
/// Closing the window only hides it, so the same NSWindow is reused for the rest of the session
/// and stays tied to the Space it was built on. Activating it from the tray then switches the
/// user to that Space instead of bringing the window to them.
#[cfg(target_os = "macos")]
fn keep_window_on_active_space(window: &WebviewWindow) {
    use objc2_app_kit::NSWindow;

    let window = window.clone();
    let dispatched = handle::Handle::app_handle().run_on_main_thread(move || {
        let pointer = match window.ns_window() {
            Ok(pointer) => pointer.cast::<NSWindow>(),
            Err(e) => {
                logging!(warn, Type::Window, "读取原生窗口句柄失败: {e}");
                return;
            }
        };
        let Some(ns_window) = (unsafe { pointer.as_ref() }) else {
            logging!(warn, Type::Window, "原生窗口句柄为空，跳过桌面跟随设置");
            return;
        };
        ns_window.setCollectionBehavior(active_space_collection_behavior(ns_window.collectionBehavior()));
    });
    if let Err(e) = dispatched {
        logging!(warn, Type::Window, "无法在主线程设置窗口桌面跟随行为: {e}");
    }
}

/// Defers recovery of a terminated hidden main webview until its next activation.
#[cfg(target_os = "macos")]
static WEBVIEW_NEEDS_RELOAD: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
pub fn take_webview_needs_reload() -> bool {
    WEBVIEW_NEEDS_RELOAD.swap(false, std::sync::atomic::Ordering::SeqCst)
}

///
/// macOS may kill hidden WebContent under memory pressure. Clean orphaned Mihomo subscriptions,
/// reload visible webviews immediately, and defer a hidden main-window reload until activation.
/// Registering this callback replaces Tauri's default automatic reload.
#[cfg(target_os = "macos")]
pub fn on_web_content_process_terminated(
    webview: &tauri::Webview,
    _termination: &tauri::webview::WebContentProcessTermination,
) {
    if handle::Handle::global().is_exiting() {
        return;
    }

    logging!(
        warn,
        Type::Window,
        "WebView 渲染进程已被系统终止（label={}），开始恢复",
        webview.label()
    );

    let window = webview.window();
    let is_user_visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);

    // Only the main window has a path that consumes the deferred marker.
    let is_main_window = webview.label() == "main";
    let reload_now = is_user_visible || !is_main_window;

    if !reload_now {
        WEBVIEW_NEEDS_RELOAD.store(true, std::sync::atomic::Ordering::SeqCst);
        logging!(info, Type::Window, "窗口不可见，页面将在下次打开窗口时重载");
    }

    // Clean before reload so cleanup cannot remove subscriptions created by the new page.
    let webview = webview.clone();
    crate::process::AsyncHandler::spawn(move || async move {
        if let Err(err) = handle::Handle::mihomo().clear_all_ws_connections() {
            logging!(warn, Type::Window, "清理 Mihomo WebSocket 连接失败: {err}");
        } else {
            logging!(info, Type::Window, "已清理全部 Mihomo WebSocket 连接");
        }
        if reload_now {
            logging_error!(Type::Window, webview.reload());
        }
    });
}

/// Consumes the shared marker for native unminimize paths that bypass `activate_window`.
#[cfg(target_os = "macos")]
pub fn reload_main_window_if_needed() {
    if !take_webview_needs_reload() {
        return;
    }
    let Some(window) = crate::utils::window_manager::WindowManager::get_main_window() else {
        return;
    };
    logging!(info, Type::Window, "渲染进程曾被系统终止，窗口聚焦后重载页面");
    if let Err(e) = window.reload() {
        logging!(warn, Type::Window, "重载页面失败: {e}");
    }
}
