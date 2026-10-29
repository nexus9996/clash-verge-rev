# Elevated Core Publisher — Security Review

Status: **static review plus a macOS-target type/lint pass with the Linux branches temporarily
force-enabled. Linux-target compilation and all Linux runtime verification are BLOCKED on this
macOS host.** The publisher is Linux-only code (`#[cfg(target_os = "linux")]`), so nothing here was
compiled for Linux or executed. See [Verification status](#verification-status) for exactly which
items are static-review-only and [Linux manual test checklist](#linux-manual-test-checklist) for
the hands-on tests that are required before merge/release.

Source of the port: upstream PR #8408 "fix(core): replace the packaged core through one elevated
run on Linux" (head `bf7d853d`, merge-base `3d9a79a3`), adapted to this fork's core-version
management refactor (staged core in a user-writable location, bounded unpack, explicit-version
install, shared `install_managed_core`).

## 1. Summary

The feature replaces the managed mihomo core under `/usr/bin` (or the equivalent package-owned
directory) through **one** pkexec/sudo self re-exec of the app binary with `--replace-core`. The
privileged run validates the target path against the directory of the running executable, verifies
the staged bytes against a caller-supplied sha256, copies them to a root-only `.next` name beside
the target, re-verifies the copy, and only then renames it over the live file. If a Service is
installed it hands the same file to the service installer inside the same elevated run, so the
user sees a single authorization prompt.

Overall verdict: the design is sound for its threat model (bug-fix privilege boundary for
*packaged* installs; no new root-executed code path that a user without polkit rights can reach).
Static review found **no blocking vulnerability**, but several **medium** hardening gaps that
should be addressed or consciously accepted before shipping: authorization-denial handling
(finding F1), trusted-binary resolution / environment sanitization (F2), staging-directory
permissions (F3), and unvalidated source files on the privileged side (F4). Findings F5–F12 are
low/informational.

## 2. Data flow and trust boundaries

```
GitHub release (TLS)                                  unprivileged app process (user)
      |                                                        |
      v                                                        v
 download (<=64 MiB) --unpack_with_limit--> staged core (<=256 MiB, mode 0755)
      (BoundedWriter)                          in a user-writable dir (user data for
                                                packaged installs, target dir otherwise)
                                                        |
                                          run staged core -v, compare version
                                                        |
                                        sha256(staged) caller-side digest
                                                        v
        ======================= trust boundary: polkit =======================
                                                        |
                                   pkexec app --replace-core --source S --target T
                                            --sha256 D [--publish-service]
                                                        v
                                      root helper (this module, no Tauri runtime)
                       validate: T basename in {verge-mihomo, verge-mihomo-alpha}
                                 canonicalize(dir(T)) == canonicalize(dir(current_exe))
                                 sha256(S) == D
                                                        |
                                   copy S -> T.next (root-owned, 0755) -> sha256(T.next)==D
                                                        |
                                              rename(T.next, T); fsync(dir)
                                                        |
                                   print CLASH_VERGE_CORE_REPLACED_V1=1
                                                        |
                                   [--publish-service] run clash-verge-service-install
                                     as root, core-only, digest re-verified by installer
                                                        |
                                                        v
                                 /var/lib/clash-verge-service/cores/verge-mihomo
```

Assets protected:

1. Integrity of the executable that the root-run Clash Verge Service starts (approved copy under
   `/var/lib/clash-verge-service/cores/`).
2. Integrity and availability of package-managed files under `/usr/bin`.
3. The user's authorization decision: elevation must happen only for the operation the prompt
   implies, and a denial must stop it.

## 3. Threat model

Untrusted inputs:

- **The downloaded core package and release metadata.** The package comes from GitHub over TLS and
  is unpacked under local limits; there is no release signature check (no minisign/GPG), so a
  GitHub/account/TLS compromise or a malicious release is in scope. The package never reaches the
  privileged process as an archive: only the unpacked, version-checked, sha256-attested file does.
- **The unprivileged app process itself.** Anything that can run code as the desktop user can call
  the same pkexec helper with arbitrary `--source`/`--sha256`; the polkit prompt is the only gate.
  The attestation therefore binds "root installs exactly the bytes the unprivileged caller read",
  not "the bytes are trustworthy".
- **Other local users / local processes.** The staging and rollback copies live in user data; the
  elevated run must not let a different local user influence them. The privileged side runs as
  root, so path/TOCTOU handling is security-relevant.
- **The environment** (`PATH`, `TMPDIR`, XDG dirs, `APPIMAGE`) inherited by the app and by the
  elevated child. pkexec sanitizes some variables, sudo preserves others; the helper must not
  depend on a trusted environment.
- **The target path.** `/usr/bin` is root-owned, but the same code runs for any packaged layout
  and for developer builds, so the privileged side must validate rather than assume.

Threat actors considered: remote attacker controlling a release; unrelated local user; compromised
process under the same user; a user who approves/denies polkit prompts (not considered an
adversary); a concurrently running package manager or service operation (race, last writer wins).

Explicit non-goals: protection against a malicious root, against `pkexec` itself, or against the
user deliberately typing their password for an attacker-supplied prompt.

## 4. Findings

Severity is relative to the threat model above; "Upstream" notes whether the identical issue
exists in PR #8408.

### F1 — Authorization denial falls through to sudo (Medium)

Location: `src-tauri/src/utils/elevated.rs::run_elevated`.

`run_elevated` falls back to `sudo` whenever the `pkexec` invocation exits non-zero, not only when
no polkit agent exists. pkexec uses exit code 126/127 for "not authorized / authentication
dismissed", so a user who **cancels or denies** the polkit dialog can immediately be asked again by
sudo (where a graphical askpass is configured), or receive a confusing sudo error instead of the
denial. The elevated side also cannot distinguish denial from a failed replacement.

Recommendation: fall back to sudo only when pkexec could not run at all (spawn error, exit 127 /
"no agent to ask" case), and surface 126 as a distinct "authorization denied/cancelled" error so
the UI can abort cleanly. Log the resolved elevator and its exit status.

Upstream: same behavior (open).

### F2 — Elevator/sudo resolved through PATH; elevated child environment not sanitized (Medium)

Location: `src-tauri/src/utils/elevated.rs::run_elevated`,
`src-tauri/src/utils/help.rs::linux_elevator`.

`linux_elevator()` shells out to `which pkexec` (itself resolved through `PATH`) and returns the
printed path; `run_elevated` then executes that string, and the fallback runs bare `sudo`. The
elevated app mode reads no environment variables, but the environment **is inherited by the child
processes it spawns**, notably the service installer launched through
`clash_verge_service_ipc::management::install` (which inherits `TMPDIR` for its 0700 staging
directory and `PKEXEC_UID`/`SUDO_UID` for group resolution). A manipulated `PATH` is not a direct
privilege escalation (the spoofed binary runs as the calling user), but it can spoof the flow and
the variables passed into root code.

Recommendation: resolve the elevator with absolute paths (`/usr/bin/pkexec`, `/usr/bin/sudo`),
verify it is a root-owned, non-group/world-writable regular file (or `lstat` + owner check) before
exec, and pass a minimal explicit environment to the elevated child (pkexec needs `DISPLAY`/
`XAUTHORITY` for the agent; the privileged mode itself does not need the desktop environment).
Never rely on the inherited `TMPDIR`/XDG values inside root code.

Upstream: same (open).

### F3 — Staging directory: fixed name, default permissions, no ownership check (Medium)

Location: `core_upgrade.rs::staging_directory` (Linux elevated path only).

For packaged installs the staged core and the rollback copy live in
`$XDG_DATA_HOME/<app-id>/core-upgrade` (normally `~/.local/share/.../core-upgrade`). The directory
is created with `create_dir_all`, i.e. mode 0755 minus umask; **no 0700 mode and no ownership or
parent-permission check is applied**. Directory contents are public-release binaries, so
confidentiality is not the main issue; the risk is a misconfigured or attacker-writable
`XDG_DATA_HOME`/`HOME` chain allowing another local user to pre-create or replace
`core-upgrade/.verge-mihomo.rollback` (fixed name) or guess the staging file name, and thereby
influence bytes that root later installs during a rollback (see F7).

Recommendation: create the directory with mode 0700 (and fix permissions if it already exists),
verify it is a directory owned by the current uid and not group/world writable, and refuse
otherwise. Prefer a per-user runtime directory that is guaranteed private (e.g.
`$XDG_RUNTIME_DIR`) when the filesystem is not mounted `noexec`; document that staging under a
`noexec` home breaks the pre-publish `-v` probe (operational risk below).

Upstream: open (same `create_dir_all`).

### F4 — Privileged side accepts any `--source`: file type/size/ownership not validated (Medium)

Location: `src-tauri/src/utils/elevated.rs::replace` / `publish`.

The root helper only compares `sha256(source)` with the caller-supplied digest. It does not:

- require `source` to be a regular file (`File::open` follows symlinks; a FIFO blocks the root
  process indefinitely, a device can stream data until the disk fills);
- cap the number of bytes copied (an attacker-controlled source can exhaust `/usr` while root
  copies);
- check `source` ownership/mode (`sha256_file` reads whatever path is given).

Because the helper can be invoked by any local user through pkexec, these are (mostly) root-DoS /
prompt-spoofing concerns rather than escalation, but they are cheap to close.

Recommendation: `symlink_metadata` the source, require a regular file owned by the invoking user
(or root) and not group/world writable; reject entries above `MAX_UNPACKED_CORE_BYTES` before
copying and enforce a hard byte cap while copying; open with `O_NOFOLLOW|O_CLOEXEC`, and hash from
the same fd that is copied (or hash after copy as today plus the fd-level check).

Upstream: open.

### F5 — Target path validation is good; directory ownership is not verified (Low)

Location: `src-tauri/src/utils/elevated.rs::replace`.

Validated: target basename must be exactly `verge-mihomo` or `verge-mihomo-alpha`; the target's
parent must canonicalize to the same directory as `current_exe()`; only `verge-mihomo.next` and
the rename touch the live path. Relative paths, `..`, symlinked directories and non-core names are
rejected (canonicalization + basename whitelist). A symlink *at the target path* is not followed:
`rename` replaces the directory entry, so it cannot be used to write through to another file.

Residual: the helper never checks that the target directory is actually **root-owned and not
user-writable**. If the app is installed in a user-writable directory, a user can make root write
files there (not an escalation, but an avoidable root-write primitive and a confusing boundary).
The directory-equals-exe-dir rule also means a package layout that keeps the core elsewhere can
never use the feature (documented limitation, not a vulnerability).

Recommendation: when running as root, require `symlink_metadata(directory)` to be a directory with
`uid == 0` and no group/other write bits (or at least warn), and reject a target that is itself a
symlink. Keep the canonicalized own-directory comparison.

Upstream: canonicalization + whitelist present; ownership check open.

### F6 — sha256 attestation semantics and TOCTOU window (Info)

Location: `core_upgrade.rs::install_managed_core`/`publish_core`,
`utils/elevated.rs::replace_root_owned_file`/`publish`.

The digest is computed on the **unpacked staged core** (not on the downloaded `.gz`/`.zip`), by the
unprivileged app, and passed on the command line. The privileged run re-hashes the source, then
re-hashes the copied `.next` file before renaming. This closes the common TOCTOU races: a swap
between the caller's hash and the privileged hash aborts; a swap between the privileged hash and
the copy is caught by hashing the copy; after the copy the source is no longer read. The digest is
not secret (visible in `/proc/<pid>/cmdline` to the same user) and does not need to be.

What it does not provide: provenance. If the unprivileged app is compromised or tricked into
staging hostile bytes, root will install exactly those bytes after the user authorizes the prompt.
The security of the update therefore still depends on the app's TLS download and version probe, and
there is no signature verification of the mihomo release itself.

Recommendation: keep the double hash; add release signature verification in the download path if
upstream mihomo publishes signatures; surface the target version in the polkit context/message if a
dedicated action is added (F12).

Upstream: same design (accepted trade-off).

### F7 — Rollback copy is user-writable and re-attested by the same user (Low)

Location: `core_upgrade.rs::stage_rollback` / `restore_core`.

For elevated installs the previous core is copied into user data
(`core-upgrade/.verge-mihomo.rollback`) because a hard link cannot be made in `/usr/bin`. On a
failed upgrade the app calls the elevated helper again with that file as source; the digest is
computed immediately before elevation, so a process running as the same user can modify the
rollback file and have root install modified bytes during rollback (subject to the polkit prompt).
This does not grant more than "any same-uid process can invoke the same helper", but it is a second,
less obvious publish channel and it bypasses the app's normal download/version verification.

Recommendation: record the rollback digest when the copy is made and verify it before restoring;
create the rollback file with `O_EXCL` and mode 0600 in a 0700 directory (F3); remove the file after
success/failure. Optionally have the elevated run create the previous-core copy itself (root-owned)
instead of copying it as the user.

Upstream: open.

### F8 — Service copy refresh inside the same elevated run (Info)

Location: `utils/elevated.rs::publish_service_core`, `core_upgrade.rs::publish_core`.

After the rename the root helper runs the packaged `clash-verge-service-install` with
`--prepare-install --core-only`; since it is already root, service-ipc's `elevate()` runs the
installer directly, so there is no second authorization prompt. The installer independently copies
`/usr/bin/verge-mihomo` into its own 0700 staging directory, computes the sha256 itself, and
publishes to `/var/lib/clash-verge-service/cores/verge-mihomo` with digest verification. The
elevated helper's own copy plus the installer's independent verification means a file swapped after
our rename is still refused or installed as the swapped bytes only if the installer's digest is
computed on the swapped file (which it is, but the service then runs what the installer verified —
acceptable: both are root-controlled paths at that point).

Residual: if only the service publication fails, the caller rolls the target back and, because the
service staging "succeeded" mapping is derived from the same elevated run, asks the same run's
follow-up restore to publish the old core to the service as well. If the service copy failed
*before* receiving bytes, the old copy is still in place and the restore is a no-op in content.
The failure classification depends on stdout markers — see F9.

Upstream: same.

### F9 — Marker-based outcome classification is racy (Low)

Location: `utils/elevated.rs::REPLACED_MARKER`, `replace_root_owned_file`.

"Core replaced, Service copy failed" is distinguished from "nothing was replaced" by parsing
`CLASH_VERGE_CORE_REPLACED_V1=1` from the elevated process's stdout. The marker is printed after
the rename, so if the child is killed (SIGTERM, polkit/agent teardown, OOM) between the rename and
the print, the caller classifies the attempt as "not replaced" and skips rollback even though the
live file changed. The next upgrade attempt then reads the new version, may report "nothing to do",
and the Service keeps the old core. This is a narrow window but it crosses a privilege boundary and
a security-relevant decision (rollback).

Recommendation: use a dedicated exit code (`Published` vs `PublishedServiceFailed` vs `Failed`) or
an atomic status file in a root-owned directory; or have the caller compare `sha256(target)` with
the staged digest when the elevated run reports failure. Do not use free-form stdout for state.

Upstream: open.

### F10 — Partial copy / stale `.next` handling (Info)

Location: `utils/elevated.rs::publish` / `remove_stale_staging`.

The copy is made to `/usr/bin/verge-mihomo.next` (`create_new`, mode 0755 only after the copy) and
only renamed after the digest check, so an interrupted copy never leaves a partial live file; at
worst a stale root-owned `.next` remains and the next run removes it. The file is chmod 0755 before
the digest check, but it is not executed, and the service's core resolver rejects the `.next`
extension. No partial file can appear at `/usr/bin/verge-mihomo` itself.

Residual: `remove_stale_staging` deletes any `.next` found, including one being written by a
concurrent root process (package manager or another app instance's elevated run); the fixed names
imply only one privileged writer. Concurrent package-manager updates of the package (which also
owns `/usr/bin/verge-mihomo`) can race the rename and win/lose as last writer.

Upstream: same.

### F11 — AppImage guard (local deviation) (Info)

Location: `core_upgrade.rs::read_only_appimage`, `staging_directory`.

This fork ships an AppImage (upstream #8276, merged after the PR's base). AppImage runs the app and
core from a read-only squashfs mount, so elevation cannot publish into it. Without a guard the new
code would ask for a polkit password and then fail with EROFS. The port adds a Linux-only guard: if
`APPIMAGE` is set and elevation would be required, the upgrade fails early with
"in-app core replacement is unavailable in the AppImage build because its payload is mounted
read-only; update the AppImage to change the core" and **no password prompt is shown**.

Residual: an extracted AppDir launched with a stale `APPIMAGE` env var would be blocked; the guard
must be revisited if AppImage core replacement is implemented later.

Upstream: N/A (feature shipped after the PR base).

### F12 — Generic polkit action, no dedicated policy (Info)

Location: invocation via `pkexec <app> --replace-core ...` (this module); the service installer uses
the same generic mechanism.

The polkit prompt uses the generic `org.freedesktop.policykit.exec` action for the app binary. The
user sees a generic "authentication is required to run <app> as the super user" prompt, not a
message explaining that the *system mihomo core* will be replaced and why. There is no packaged
polkit policy that pins the action to the packaged app path or restricts it to admin users, so
there is no policy layer to audit or harden; the prompt text is not actionable.

Recommendation: ship a polkit policy file (owned by the deb/rpm/AUR package) that scopes
`org.freedesktop.policykit.exec.path` to the packaged app path and, if feasible, a dedicated
action with a clear message; document the required polkit version.

Upstream: open.

## 5. What upstream PR gets wrong or leaves open (consolidated)

1. **Denial handling**: falls back to sudo on any pkexec failure, including a dismissed/denied
   authorization (F1) — the caller cannot tell a denial from a failed replacement.
2. **Environment / elevator resolution**: PKEXEC/sudo are found through `PATH`, and the child
   environment (notably `TMPDIR`, `PKEXEC_UID`) is inherited by root-run child processes (F2).
3. **Staging permissions**: fixed-name staging directory under user data created with default
   permissions, no 0700/ownership validation (F3).
4. **Unvalidated privileged source**: no regular-file/size/ownership checks on `--source`; the
   copy is unbounded and `File::open` follows special files (F4).
5. **No target-directory ownership check**: the helper never proves the target directory is
   root-owned and non-writable; a user-writable install directory lets a user make root write
   files there (F5).
6. **Racy state signalling**: "replaced" is communicated on stdout instead of an exit code/status
   file (F9).
7. **Rollback integrity**: the rollback copy is user-writable and re-attested by the same user
   (F7); combined with F3 this is the most plausible local influence path on a future rollback.
8. **No polkit policy**: generic action, generic prompt (F12).
9. **Sidecar/service drift fix is not Linux-only in upstream**: upstream also changes macOS
   behaviour (stages the Service copy whenever a Service is installed, adding a prompt on macOS
   sidecar upgrades). This port keeps the change Linux-only to preserve macOS/Windows behaviour,
   per the fork's porting constraints; upstream may want to revisit the macOS prompt cost.
10. **Opened window to package-manager races**: no coordination with the package manager that also
    owns the target file; last-writer-wins (F10). Acceptable for a user-initiated upgrade.

## 6. Local adaptation notes (differences from the upstream patch)

- The publisher is wired into the local shared `install_managed_core`, so **both** the automatic
  upgrade path and the explicit-version install/picker path (`install_core_version`) use it; the
  upstream patch only covered `upgrade_core` (its base predates the version picker).
- Local staging/limits are preserved and reused: 64 MiB download cap, 256 MiB
  `MAX_UNPACKED_CORE_BYTES` with `BoundedWriter`/`unpack_with_limit`, staged-core `-v` version
  check before publishing. The elevated run copies the already-bounded file; it never unpacks
  archives.
- Local staging is the existing `spawn_blocking` + retry-created file in user data for elevated
  installs (`core-upgrade`), with the rollback copy beside it; the non-elevated paths are
  unchanged (hard link + rename beside the target).
- The Service refresh widening (`service_installed()`) is **Linux-only** here; macOS/Windows keep
  the previous "only when running in Service mode" behaviour.
- AppImage guard added (F11): local ships an AppImage that the PR base predates.
- Additive wiring: `main.rs` early dispatch, `utils/mod.rs` module declaration,
  `Changelog.md` entry.

## 7. Verification status

### Performed on this host (macOS, rustc 1.99.1)

- `cargo fmt --all -- --check`: **PASS** (also direct `rustfmt --check` on the changed files).
- `cargo check -p clash-verge --locked`: **PASS** (macOS target; Linux cfg-gated code excluded).
- `cargo clippy -p clash-verge --all-targets --features clippy -- -D warnings`: **PASS**
  (macOS target; see caveat below).

Supplementary type/lint pass for the Linux-only branch: because `cfg(target_os = "linux")` code is
elided on macOS, a **temporary, uncommitted local patch** force-enabled the Linux branches on the
macOS target (`cfg(any(target_os = "linux", target_os = "macos"))` in the four touched files, with
the Linux `linux_elevator()` and `libc` calls compiled as-is because they are portable across
Unix). With that patch, `cargo check -p clash-verge --locked` and
`cargo clippy -p clash-verge --all-targets --features clippy -- -D warnings` both **passed**, so
`elevated.rs`, `publish_elevated`, `service_installed`, `directory_is_writable`,
`read_only_appimage` and the `main.rs` dispatch have had their syntax, types and local lints
checked. This is a macOS-target compile with Linux branches forced on, **not** a Linux-target
build: it does not validate Linux-target dependency resolution, packaging/AppImage runtime
behavior, or any actual pkexec/service-installer execution. The temporary patch was reverted and
the tree was verified byte-identical (sha256) before the final verification run recorded above.

### NOT compiled for a Linux target and NOT executed on this host

Linux-only items elided by `cfg(target_os = "linux")` on macOS (typechecked with the temporary
cfg expansion described above, but never compiled for Linux or executed):

- `src-tauri/src/utils/elevated.rs`: the **entire** new module (argument parsing, pkexec/sudo
  invocation, root check, target/digest validation, staged copy + rename, marker output, service
  installer invocation, `run_if_requested()`).
- `src-tauri/src/feat/core_upgrade.rs`:
  - `SERVICE_MANAGER`/`ServiceStatus` import and `service_installed()` (Linux sidecar-to-Service
    refresh decision),
  - `publish_requires_elevation()` Linux implementation and `directory_is_writable()`
    (`libc::access`),
  - `read_only_appimage()` and the AppImage early-failure branch,
  - `publish_elevated()` Linux implementation (calls `utils::elevated::replace_root_owned_file`).
- `src-tauri/src/main.rs`: the `--replace-core` early-dispatch block (before Tauri, runtime and
  singleton initialization).
- `src-tauri/src/utils/mod.rs`: the `elevated` module declaration.

The non-Linux variants of those functions (const `false`/bail! stubs), `publish_core`,
`restore_core`, `staging_directory`, `rollback_path`, `stage_rollback`, `StagedCore` and the
reworked `install_managed_core` **are** compiled and linted on macOS.

Cross-compilation was attempted as a next step and is **not possible on this host**:
`cargo check --target x86_64-unknown-linux-gnu` cannot run because the Linux target std and native
libs are not installed, and this environment has no package-install path for a Linux sysroot.
There is no Linux machine or VM available here, so **no Linux-target compile and no runtime
validation is claimed anywhere in this document** (the cfg-expanded macOS typecheck above is not a
substitute). The Linux-only code above must still be compiled by CI (Linux job) and exercised by
the manual checklist below before merge.

Static-review cross-checks used: the vendored `clash_verge_service_ipc` v2.7.6 source
(`management::install`, `management::sha256_file`, `CORE_STAGING_EXTENSION`, `CoreSource`, the
installer's `management::prepare_install_if_requested` and `elevate()`), the local
`core/service.rs` (`stage_approved_core`, `SERVICE_MANAGER::current`, `ServiceStatus` variants),
and the package layout in `src-tauri/tauri.linux.conf.json` (externalBin next to the app in
`/usr/bin` for deb/rpm; AppImage read-only).

## 8. Linux manual test checklist (deb/rpm)

Environment: Ubuntu 22.04/24.04 (deb) and Fedora 40+ (rpm), x86_64, a session polkit agent running
(GNOME/KDE default), a non-root account with admin (wheel/sudo) rights, one *older* core installed
by the package and one *newer* installable version available.

Preconditions:

```bash
dpkg -l clash-verge-rev 2>/dev/null || rpm -q clash-verge-rev
which clash-verge verge-mihomo clash-verge-service-install
stat -c '%U %G %a %n' /usr/bin/verge-mihomo /usr/bin   # expect root root 755, not writable by user
verge-mihomo -v
sha256sum /usr/bin/verge-mihomo
sudo sha256sum /var/lib/clash-verge-service/cores/verge-mihomo   # only if the Service is installed
systemctl status clash-verge-service
```

### T1. Service mode, automatic upgrade: exactly one prompt, both copies updated

1. Install the package, install the Service from the app, confirm Service mode is active.
2. In the app open the core version picker / run the core upgrade to a newer version.
3. Observe polkit: **exactly one** authorization prompt ("Clash Verge ... super user"); accept.
4. After success:

```bash
verge-mihomo -v                                        # new version
stat -c '%U %G %a' /usr/bin/verge-mihomo                # root root 755
ls -la /usr/bin/verge-mihomo*                          # only the two cores; no *.next leftover
sha256sum /usr/bin/verge-mihomo
sudo sha256sum /var/lib/clash-verge-service/cores/verge-mihomo   # same digest (Service copy refreshed)
systemctl status clash-verge-service                   # running, no crash loop
journalctl -u clash-verge-service -n 50                # starts the new core, no digest mismatch
ps aux | grep -i mihomo                                # new binary path, running
```

5. No second polkit/sudo prompt during the whole operation; no core restart failure notification.
6. `ls -la ~/.local/share/io.github.clash-verge-rev.clash-verge-rev/core-upgrade`: no leftover
   staging/rollback files after success.

### T2. Sidecar mode with Service installed: Service copy still refreshed

1. Keep the Service installed, switch the app to Sidecar mode (or stop the Service but keep it
   registered), upgrade the core.
2. Expect one prompt, `/usr/bin/verge-mihomo` updated and the Service approved copy updated.
3. Switch back to Service mode and confirm the running kernel is the new version (not the
   previously approved one).

### T3. Corrupt / invalid package: rollback, no partial file in /usr/bin

Two variants:

- **Pre-publish corruption** (recommended first): make the downloaded asset corrupt, e.g. with a
  local proxy or a local file server serving a truncated/random `.gz`. Start the upgrade. Expect:
  unpack/version probe fails **before any polkit prompt**; `verge-mihomo -v` and both sha256 values
  unchanged; no `.next` file.
- **Post-publish failure** (advanced): serve a package that passes unpack and `-v` (a fake binary
  that prints a matching version) so publication happens, then make the restart fail (e.g. the fake
  binary exits non-zero when started normally). Expect: one prompt, target temporarily replaced,
  restart failure, rollback restores the previous `/usr/bin/verge-mihomo` and the Service copy;
  `verge-mihomo -v` reports the old version afterwards; no error/partial file left behind; app
  logs the rollback reason.

Acceptance: after failure, `ls -la /usr/bin/verge-mihomo*` shows only the two core files (no
`.next`), the Service still starts, and the app reports the failed upgrade rather than the new
version.

### T4. Authorization denied: clean abort, nothing changed

1. Start an upgrade, then **cancel/dismiss** the polkit prompt.
2. Expect: app reports failure, no files changed under `/usr/bin`, no partial `.next`, Service
   copy untouched, app keeps running the current core.
3. Current implementation note (finding F1): it may immediately try sudo; on a desktop without a
   terminal sudo fails without a prompt. Record the second-attempt behavior and the exact error
   text; it must not leave partial state. F1 recommends removing the sudo fallback for denials.
4. Repeat with polkit absent (minimal WM, no agent): expect either a clear "no agent" failure or
   the documented sudo fallback, never a half-applied replacement.

### T5. AppImage guard (local deviation)

Run the AppImage, attempt a core upgrade. Expect the immediate error "in-app core replacement is
unavailable in the AppImage build because its payload is mounted read-only; update the AppImage to
change the core" and **no polkit prompt**, no file change inside the mount.

### T6. No Service installed (sidecar-only): single prompt, no Service side effects

Install the package, do not install the Service, upgrade the core in Sidecar mode. Expect one
prompt, `/usr/bin/verge-mihomo` updated, no Service installer invocation (check app logs /
`journalctl`), and the running sidecar uses the new core after restart.

### T7. Explicit-version install (local version picker)

Use "Mihomo 版本" to install a specific older/newer version (not only "upgrade latest"). Expect the
same one-prompt behavior and the same verification as T1. This path shares
`install_managed_core` with the upgrade path; verify the version picker reports the installed
version afterwards.

### T8. Package-manager coexistence

Upgrade the app via `apt`/`dnf` (which also replaces `/usr/bin/verge-mihomo`), then perform an
in-app core upgrade. Expect no permission errors, and the package manager does not report a
corrupted install when reinstalling the same package version (`dpkg -V clash-verge-rev` may still
flag the core as modified after an in-app upgrade; record the expected behavior for the packaging
docs).

Logs to collect for every test: app log
(`~/.local/share/io.github.clash-verge-rev.clash-verge-rev/logs`), `journalctl -u
clash-verge-service -n 100`, and the polkit agent log if available. Use
`strace -f -e trace=execve,rename,renameat2 -o /tmp/upgrade.trace clash-verge` when validating
that exactly one elevated exec happens.

## 9. Residual risks accepted by this port

- No release signature verification; trust in the mihomo release/GitHub/TLS remains (F6).
- The user-writable rollback copy remains a same-user influence path (F7), accepted until the
  hardening in F3/F7 is implemented.
- The elevated helper is a general "install these bytes as the packaged core" primitive for any
  caller who can invoke it; the polkit prompt is the gate (inherent to pkexec-based designs).
- Linux-only code ships compiled only in Linux CI; the manual checklist above is mandatory before
  release.

## 10. Follow-up hardening (suggested order)

1. F1 denial handling (exit-code-aware fallback, distinct user-visible error).
2. F3/F7 staging and rollback directory/file permissions, digest of rollback copy, ownership
   checks.
3. F4 privileged source validation (regular file, size cap, owner/mode) and F5 target-directory
   ownership check.
4. F2 absolute elevator paths + explicit child environment.
5. F9 exit-code/state-file instead of stdout marker.
6. F12 packaged polkit policy.
