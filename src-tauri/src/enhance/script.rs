use crate::{process::AsyncHandler, utils::tmpl};

use super::field::use_lowercase_owned;
use anyhow::{Error, Result};
use clash_verge_logging::{Type, logging};
use parking_lot::Mutex;
use rquickjs::{Context, Function, Runtime};
use serde::ser::SerializeMap as _;
use serde_yaml_ng::Mapping;
use smartstring::alias::String;
use std::{
    cell::RefCell,
    sync::Arc,
    time::{Duration, Instant},
};

const MAX_OUTPUTS: usize = 1000;
const MAX_OUTPUT_SIZE: usize = 1024 * 1024; // 1MB
const MAX_JSON_SIZE: usize = 10 * 1024 * 1024; // 10MB
const MAX_INTERRUPT_CHECKS: u64 = 100_000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5);
const RUNTIME_MEMORY_LIMIT: usize = 256 * 1024 * 1024;
const RUNTIME_STACK_SIZE: usize = 1024 * 1024;
const ERROR_FLAG: &str = "__error_flag__ ";

// Output limits are enforced here so an over-limit console call fails immediately instead of
// waiting for the next interpreter interrupt; the host side keeps the same caps as a backstop.
const CONSOLE_SCRIPT: &str = r#"var __verge_log_count = 0;
var __verge_log_size = 0;
function __verge_push_log(level, data) {
  var text = JSON.stringify(data, null, 2);
  __verge_log_count = __verge_log_count + 1;
  __verge_log_size = __verge_log_size + level.length + text.length;
  if (__verge_log_count > 1000) throw new Error("Maximum number of log outputs exceeded");
  if (__verge_log_size > 1048576) throw new Error("Maximum output size exceeded");
  __verge_log__(level, text);
}
var console = Object.freeze({
  log(data){__verge_push_log("log",data)},
  info(data){__verge_push_log("info",data)},
  error(data){__verge_push_log("error",data)},
  debug(data){__verge_push_log("debug",data)},
  warn(data){__verge_push_log("warn",data)},
  table(data){__verge_push_log("table",data)},
});"#;

type ScriptResult = (Mapping, Vec<String>, Vec<(String, String)>);
type EvalOutcome = (Result<Mapping, std::string::String>, Vec<(String, String)>);

// One runtime per worker thread: creating a QuickJS runtime per script is measurable and the
// runtime stays usable for later script runs on the same thread.
thread_local! {
    static JS_RUNTIME: RefCell<Option<Runtime>> = const { RefCell::new(None) };
}

fn with_runtime<T>(f: impl FnOnce(&Runtime) -> Result<T, std::string::String>) -> Result<T, std::string::String> {
    JS_RUNTIME.with(|slot| {
        if slot.borrow().is_none() {
            let runtime = Runtime::new().map_err(|err| format!("Failed to create the script runtime: {err}"))?;
            runtime.set_memory_limit(RUNTIME_MEMORY_LIMIT);
            runtime.set_max_stack_size(RUNTIME_STACK_SIZE);
            *slot.borrow_mut() = Some(runtime);
        }

        let slot = slot.borrow();
        let runtime = slot
            .as_ref()
            .ok_or_else(|| "script runtime is not initialized".to_owned())?;
        f(runtime)
    })
}

#[derive(Default)]
struct SandboxState {
    outputs: Vec<(String, String)>,
    total_size: usize,
    aborted: Option<&'static str>,
}

impl SandboxState {
    fn push_output(&mut self, level: std::string::String, data: std::string::String) {
        if self.aborted.is_some() {
            return;
        }
        if self.outputs.len() >= MAX_OUTPUTS {
            self.aborted = Some("Maximum number of log outputs exceeded");
            return;
        }
        let new_size = self.total_size + level.len() + data.len();
        if new_size > MAX_OUTPUT_SIZE {
            self.aborted = Some("Maximum output size exceeded");
            return;
        }
        self.total_size = new_size;
        self.outputs.push((level.into(), data.into()));
    }
}

/// Serializes the script input with lowercased top-level keys without cloning the values.
struct LowercaseKeys<'a>(&'a Mapping);

impl serde::Serialize for LowercaseKeys<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in self.0 {
            let Some(key) = key.as_str() else {
                continue;
            };
            map.serialize_entry(&key.to_ascii_lowercase(), value)?;
        }
        map.end()
    }
}

/// Never fails: exceptions are logged and the input config is returned unchanged.
pub(super) async fn use_script(script: String, config: Mapping, name: String) -> ScriptResult {
    // The template is identity-plus-lowercasing; skip the engine round-trip.
    if script == tmpl::ITEM_SCRIPT {
        return (use_lowercase_owned(config), vec![], vec![]);
    }

    let json = match serde_json::to_string(&LowercaseKeys(&config)) {
        Ok(json) if json.len() <= MAX_JSON_SIZE => json,
        Ok(_) => {
            let message = "Configuration size exceeds maximum allowed size";
            return (config, vec![], vec![("exception".into(), message.into())]);
        }
        Err(err) => return (config, vec![], vec![("exception".into(), err.to_string().into())]),
    };

    let evaluated = AsyncHandler::spawn_blocking(move || eval_script(&script, &json, &name, SCRIPT_TIMEOUT));
    let (outcome, mut logs) = match tokio::time::timeout(SCRIPT_TIMEOUT, evaluated).await {
        Ok(Ok(evaluated)) => evaluated,
        Ok(Err(join_err)) => (Err(format!("script task panicked: {join_err}")), vec![]),
        Err(_elapsed) => (
            Err(format!("script execution timed out after {SCRIPT_TIMEOUT:?}")),
            vec![],
        ),
    };

    match outcome {
        Ok(result) => {
            // Compared against the config as handed in, not the lowercased copy the script saw.
            let changed_keys = result
                .iter()
                .filter(|(key, value)| config.get(key) != Some(value))
                .filter_map(|(key, _)| {
                    let mut key: String = key.as_str()?.into();
                    key.make_ascii_lowercase();
                    Some(key)
                })
                .collect();
            (result, changed_keys, logs)
        }
        Err(reason) => {
            logs.push(("exception".into(), reason.into()));
            (config, vec![], logs)
        }
    }
}

/// Runs one script under the engine limits; console logs survive every failure path.
fn eval_script(script: &str, config_json: &str, name: &String, timeout: Duration) -> EvalOutcome {
    let state = Arc::new(Mutex::new(SandboxState::default()));
    let deadline = Instant::now() + timeout;
    let state_for_interrupt = Arc::clone(&state);

    let outcome = with_runtime(|runtime| -> Result<Mapping, std::string::String> {
        let mut checks = 0u64;
        runtime.set_interrupt_handler(Some(Box::new(move || {
            checks += 1;
            let mut state = state_for_interrupt.lock();
            if checks > MAX_INTERRUPT_CHECKS {
                state.aborted = Some("Maximum loop iterations exceeded");
                return true;
            }
            if Instant::now() >= deadline {
                state.aborted = Some("Script execution timed out");
                return true;
            }
            state.aborted.is_some()
        })));

        let outcome = eval_in_context(runtime, script, config_json, name, &state);
        runtime.set_interrupt_handler(None);
        outcome
    });

    let logs = state.lock().outputs.clone();
    (outcome, logs)
}

fn eval_in_context(
    runtime: &Runtime,
    script: &str,
    config_json: &str,
    name: &String,
    state: &Arc<Mutex<SandboxState>>,
) -> Result<Mapping, std::string::String> {
    let abort_reason = || state.lock().aborted.map(str::to_owned);

    let context = Context::full(runtime).map_err(|err| format!("Failed to create the script context: {err}"))?;
    context.with(|ctx| {
        let log_state = Arc::clone(state);
        let log = Function::new(
            ctx.clone(),
            move |level: std::string::String, data: std::string::String| {
                log_state.lock().push_output(level, data);
            },
        )
        .map_err(|err| format!("Failed to register the script logger: {err}"))?;
        ctx.globals()
            .set("__verge_log__", log)
            .map_err(|err| format!("Failed to register the script logger: {err}"))?;
        ctx.eval::<(), _>(CONSOLE_SCRIPT)
            .map_err(|err| format!("Failed to prepare the script console: {err}"))?;

        // Bind the JSON as a global instead of embedding it in program source.
        ctx.globals()
            .set("__verge_config__", config_json)
            .map_err(|err| format!("Failed to bind config for script: {err}"))?;

        let safe_name = escape_js_string_for_single_quote(name);
        if safe_name.len() > 1024 {
            return Err("Name parameter too long".to_owned());
        }

        let error_flag_literal = format!("{:?}", ERROR_FLAG);
        let code = format!(
            r"try {{
{script};
JSON.stringify(main(JSON.parse(globalThis.__verge_config__),'{safe_name}')||'')
}} catch (err) {{
{error_flag_literal} + err.toString()
}}"
        );

        let result: Result<std::string::String, _> = ctx.eval(code.as_str());
        let result = match result {
            Ok(result) => result,
            Err(err) => {
                return Err(abort_reason().unwrap_or_else(|| format!("Script execution failed: {err}")));
            }
        };

        if let Some(reason) = result.strip_prefix(ERROR_FLAG) {
            return Err(reason.trim().to_owned());
        }
        if result.len() > MAX_JSON_SIZE {
            return Err("Script result exceeds maximum allowed size".to_owned());
        }

        match parse_json_safely(&result) {
            Ok(config) => Ok(use_lowercase_owned(config)),
            Err(err) => {
                logging!(
                    error,
                    Type::Config,
                    "Script execution error: {err:#}. Script name: {name}"
                );
                Err("Script execution failed".to_owned())
            }
        }
    })
}

fn parse_json_safely(json_str: &str) -> Result<Mapping, Error> {
    if json_str.len() > MAX_JSON_SIZE {
        anyhow::bail!("JSON string too large");
    }

    let json_str = strip_outer_quotes(json_str);
    Ok(serde_json::from_str::<Mapping>(json_str)?)
}

// 安全地移除外层引号
fn strip_outer_quotes(s: &str) -> &str {
    let s = s.trim();
    if s.len() < 2 {
        return s;
    }

    let first = s.chars().next().unwrap_or_default();
    let last = s.chars().last().unwrap_or_default();
    let double_quote = char::from(34u8);
    let single_quote = char::from(39u8);

    if (first == double_quote && last == double_quote) || (first == single_quote && last == single_quote) {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

// 安全地转义字符串
fn escape_js_string_for_single_quote(s: &str) -> String {
    let source: std::string::String = s.chars().take(10240).collect();
    let backslash = char::from(92u8);
    let single_quote = char::from(39u8);
    let newline = char::from(10u8);
    let carriage_return = char::from(13u8);
    let mut escaped = std::string::String::with_capacity(source.len());

    for ch in source.chars() {
        if ch == backslash {
            escaped.push(backslash);
            escaped.push(backslash);
        } else if ch == single_quote {
            escaped.push(backslash);
            escaped.push(single_quote);
        } else if ch == newline {
            escaped.push(backslash);
            escaped.push(char::from(110u8));
        } else if ch == carriage_return {
            escaped.push(backslash);
            escaped.push(char::from(114u8));
        } else {
            escaped.push(ch);
        }
    }

    escaped.into()
}

#[cfg(test)]
mod tests {
    use super::{LowercaseKeys, MAX_OUTPUTS, eval_script};
    use crate::enhance::field::use_lowercase;
    use serde_yaml_ng::Mapping;
    use smartstring::alias::String;
    use std::time::Duration;

    fn run(script: &str, config_json: &str) -> super::EvalOutcome {
        let name: String = "test-profile".into();
        eval_script(script, config_json, &name, Duration::from_secs(1))
    }

    #[test]
    fn lowercased_script_input_matches_the_owned_mapping() -> anyhow::Result<()> {
        let config: Mapping = serde_yaml_ng::from_str(
            r#"Mode: rule
mode: global
Rules:
  - one
nested:
  Key: 1
"#,
        )?;

        assert_eq!(
            serde_json::to_value(LowercaseKeys(&config))?,
            serde_json::to_value(use_lowercase(&config))?
        );
        Ok(())
    }

    #[test]
    fn script_transforms_the_config_and_reports_logs() {
        let (outcome, logs) = run(
            r#"function main(config) {
                config.proxies = ["111"];
                console.log(config);
                return config;
            }"#,
            r#"{"rules":["111"],"tun":{"enable":false}}"#,
        );
        let config = outcome.expect("script should succeed");
        assert_eq!(
            config.get("proxies").and_then(|value| value.as_sequence()).cloned(),
            Some(vec![serde_yaml_ng::Value::from("111")])
        );
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].0.as_str(), "log");
        assert!(logs[0].1.contains("rules"));
    }

    #[test]
    fn runtime_exceptions_are_reported_to_the_caller() {
        let (outcome, _logs) = run(
            r#"function main() {
                throw new Error("boom");
            }"#,
            "{}",
        );
        let reason = outcome.expect_err("thrown exception should fail the script");
        assert!(reason.contains("Error: boom"), "{reason}");
    }

    #[test]
    fn output_limit_aborts_the_script() {
        let script = format!(
            r#"function main(config) {{
                for (let i = 0; i < {MAX_OUTPUTS} + 5; i++) console.log({{ i }});
                return config;
            }}"#
        );
        let (outcome, logs) = run(&script, "{}");
        let reason = outcome.expect_err("over-limit logging should fail the script");
        assert!(reason.contains("Maximum number of log outputs exceeded"), "{reason}");
        assert_eq!(logs.len(), MAX_OUTPUTS);
    }

    #[test]
    fn runaway_loop_is_interrupted_by_the_deadline() {
        let name: String = "test-profile".into();
        let started = std::time::Instant::now();
        let (outcome, _logs) = eval_script(
            r#"function main() { while (true) {} }"#,
            "{}",
            &name,
            Duration::from_millis(200),
        );
        let reason = outcome.expect_err("runaway loop should be interrupted");
        assert!(reason.contains("timed out"), "{reason}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
