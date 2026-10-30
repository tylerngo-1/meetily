# CI and Release Workflows

What the GitHub Actions workflows in `.github/workflows/` do, how a release is made, and which
Windows settings must not be changed separately. For building on your own machine, see
[building.md](building.md).

## Status in this fork

- Every workflow is **manual only** (`workflow_dispatch`); nothing runs on push or pull request.
  There is no test CI (TD-04); the local checks in the root [AGENTS.md](../../AGENTS.md) are the
  only safety net.
- The workflows are **upstream's signing and release setup**. This fork's repository has Actions
  enabled but **no secrets** configured and has never run a workflow.
- **No workflow can produce installers here as configured.** `tauri.conf.json` sets
  `createUpdaterArtifacts: true` with upstream's updater public key, and every workflow runs
  `tauri build` without `--no-sign`. Without a `TAURI_SIGNING_PRIVATE_KEY` secret the Tauri CLI
  stops with "A public key has been found, but no private key" (TD-28). A fork key would also not
  match upstream's public key.
- The app's updater checks upstream's `latest.json`
  (`https://github.com/Zackriya-Solutions/meeting-minutes/releases/latest/download/latest.json`),
  so a release published from this fork would never reach the app's update check.
- This fork's own builds are installed locally with `install_local.sh`; see
  [local-workflow.md](local-workflow.md).

## Workflows

| Workflow (file) | Inputs (default) | Platforms | Whisper features | `llama-helper` features | Artifacts |
|---|---|---|---|---|---|
| Build and Test - DevTest (`build-devtest.yml`) | `sign-build` (off), `upload-artifacts` (on) | macOS arm64; Windows x64; Ubuntu 22.04 (deb); Ubuntu 24.04 (AppImage, rpm) | Windows `vulkan`, Linux `openblas`, macOS default | macOS `metal`, Windows `vulkan`, Linux CPU | `meetily-devtest-<platform>-<target>-<version>`, 14 days |
| Build and Test - macOS (`build-macos.yml`) | `build-type` debug/release (release), `sign-build` (on), `upload-artifacts` (on) | macOS arm64 (dmg, app) | default | `metal` | `meetily-macos-aarch64-<profile>-<version>`, 30 days |
| Build and Test - Windows (`build-windows.yml`) | `build-type` (release), `sign-build` (on), `test-signing` (off), `upload-artifacts` (on) | Windows x64 (msi, nsis) | `vulkan` | CPU | `meetily-windows-x64-<profile>-<version>`, 30 days |
| Build and Test - Linux (`build-linux.yml`) | `build-type` (release), `ubuntu-version` 22.04/24.04 (22.04), `bundle-type` deb/appimage/rpm/all (all), `sign-build` (on), `upload-artifacts` (on) | Ubuntu | `openblas` | CPU | `meetily-linux-<ubuntu>-x64-<profile>-<version>`, 30 days |
| Build Test (`build-test.yml`) | none; signing is always on | macOS arm64, Windows x64, Ubuntu 22.04 (deb), Ubuntu 24.04 (AppImage, rpm) | via `build.yml` | via `build.yml` | `meetily-test-...` (no version in the name), 30 days |
| Release (`release.yml`) | none; signing is always on | macOS arm64, Windows x64 (no Linux) | via `build.yml` | via `build.yml` | Uploaded to a draft GitHub release |
| Build (`build.yml`) | Called by other workflows only (`workflow_call`) | Any | Windows `vulkan`, Linux `openblas`, macOS default | macOS `metal`, Windows and Linux CPU | `<asset-prefix>-<target>` (Linux: `<asset-prefix>-<platform>-<target>`), 30 days |
| Validation Check (`pr-main-check.yml`) | none | Ubuntu, no build | | | Prints the version and branch; warns if the version is not `X.Y.Z` |

- "macOS default" means no extra feature: on macOS `whisper-rs` always gets Metal and CoreML
  (see [building.md](building.md#4-how-gpu-acceleration-is-chosen)).
- The Windows sidecar is built with Vulkan only in DevTest; `build.yml` (so Release and Build Test)
  and `build-windows.yml` build it CPU-only (TD-29).
- `build-linux.yml` installs a Vulkan SDK from LunarG's repository but builds with `openblas` (TD-30).
- DevTest uploads the DMG, `.app`, `.app.tar.gz` and its `.sig` (macOS); MSI, NSIS `.exe` and
  their `.sig` files (Windows); `.deb`, `.AppImage`, `.rpm` (Linux). Upstream's estimate: about
  25-30 minutes unsigned, 35-45 minutes signed.
- With signing on, macOS builds are signed and notarized and checked with `codesign` and `spctl`;
  Windows installers are signed with DigiCert KeyLocker and checked with `Get-AuthenticodeSignature`.
- All workflows that build use Node 20 and pnpm 9.15.9 and install with `pnpm install --frozen-lockfile`.
- To run one: GitHub → **Actions** → pick the workflow → **Run workflow** → choose the branch and inputs.

```
build.yml (reusable)
    |-- build-test.yml
    |-- release.yml

Standalone (do not use build.yml):
    build-devtest.yml, build-macos.yml, build-windows.yml, build-linux.yml,
    pr-main-check.yml (validation only)
```

A change to build steps usually has to be made in `build.yml` **and** in the standalone workflow
for that platform (and in `build-devtest.yml`); they do not share code.

## Hardware acceleration in CI

| Platform | Whisper | Distribution baseline |
|---|---|---|
| macOS | Metal and CoreML (always on for macOS builds; no feature flag) | Apple Silicon |
| Windows | Vulkan (`--features vulkan`) | AVX2-capable x64 CPU; AVX-512 disabled ([below](#windows-portability-keep-as-a-unit)) |
| Linux | OpenBLAS on CPU (`--features openblas`) | Source-build configuration |

- Windows packages never select CUDA; CUDA needs NVIDIA hardware, the CUDA toolkit and a source build.
- Linux CI uses OpenBLAS because GitHub's Linux runners have no GPU. Local Linux builds should use
  the backend that matches their own hardware and SDKs ([building.md](building.md#5-gpu-setup-linux-and-windows)).
- The Vulkan SDK is a native build prerequisite; `pnpm install` does not install it.

## Releasing (upstream's process)

`release.yml`:

1. Reads the version from `frontend/src-tauri/tauri.conf.json`. If tag `v<version>` does not exist
   it uses `<version>`; otherwise it uses the next free `<version>.N` (`0.4.1` → `0.4.1.1` →
   `0.4.1.2`, up to `.100`, after which the job fails until `tauri.conf.json` is bumped).
2. Creates a **draft** GitHub release with that tag.
3. Builds macOS and Windows through `build.yml` with signing on; `tauri-action` uploads the
   installers, updater bundles, `.sig` files and `latest.json` to the draft.
4. Prints a summary. Uploading `latest.json` to `s3://meetily-updates/latest.json` is a manual step.

- The `.N` suffix only names the tag and release. `build.yml` reads the version from
  `tauri.conf.json` and does not change it, so the app in `v0.4.1.1` still reports `0.4.1`.
- Release outputs: macOS DMG, `.app.tar.gz` (updater) and `.sig`; Windows MSI and NSIS installers
  (signed) and `.sig` files; `latest.json`. Linux is not released; use `build-linux.yml`.
- Windows MSI needs a numeric version: use `0.1.3`, not `0.1.2-pro-trial`.

## Secrets

This fork has none of these. Which ones a run needs:

| Secret | Needed when |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Every build that bundles (updater signatures; see [Status](#status-in-this-fork)) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `KEYCHAIN_PASSWORD` | macOS with signing on (signing and notarization) |
| `SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`, `SM_CODE_SIGNING_CERT_SHA1_HASH` | Windows with signing on (DigiCert KeyLocker) |
| `MEETILY_RSA_PUBLIC_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Never: passed to the build, but no code reads them (TD-31) |
| `GITHUB_TOKEN` | Provided by GitHub |

Signing adds roughly 10-15 minutes per run (upstream's estimate).

## Windows portability (keep as a unit)

The text below comes from upstream's former `.github/workflows/ACCELERATION_GUIDE.md` and is kept
word for word; only the headings were adapted. The files it refers to are
`.github/force-portable-ggml.cmake`, `.github/verify-portable-ggml.cjs` (tested by
`verify-portable-ggml.test.cjs`; run `node --test .github/verify-portable-ggml.test.cjs`) and the
three workflows named below.

### Windows builds (Vulkan GPU)

```yaml
args: --target x86_64-pc-windows-msvc --features vulkan
```

**What this provides:**

- Vulkan-enabled Whisper for Windows packages.
- Compatibility with Vulkan-capable AMD, Intel, and NVIDIA hardware.
- A repeatable CI configuration instead of a package specialized for the CI runner.

**How it works:**

- CI installs Vulkan SDK `1.4.309.0` and validates its environment before building.
- The Tauri build enables the Vulkan feature for Windows.
- The packaged artifact remains Vulkan-based; CUDA is a source-build choice.

### Windows CPU portability

A release installer is intentionally different from a build optimized for one local machine:

- Rust targets `x86-64-v2`.
- Native Whisper retains AVX2 with host-native specialization disabled.
- `GGML_AVX512`, `GGML_AVX512_VBMI`, `GGML_AVX512_VNNI`, and `GGML_AVX512_BF16` must all be OFF.

The workflows set `CMAKE_PROJECT_INCLUDE` to `force-portable-ggml.cmake`, which forces:

```cmake
set(GGML_NATIVE OFF CACHE BOOL "Build without host CPU specialization" FORCE)
```

Rust target flags do not configure Whisper's native C/C++ compilation. Do not replace the checked-in release configuration with the old `WHISPER_NATIVE=OFF` workaround or plain `GGML_*` environment variables.

### Portable cache and pre-bundle verification

Windows portable builds use the `windows-portable-v1` Rust-cache prefix, preventing an earlier host-native target cache from being restored through a fallback key.

Before bundling, `verify-portable-ggml.cjs` reads Whisper's generated CMake cache. It fails the build if native-build evidence is missing, `GGML_NATIVE` is enabled, or any of the four AVX-512 options is enabled. This prevents an unverified native library from becoming an installer asset.

### Workflows that must stay in sync

#### `build.yml` (Shared Release Workflow)

When building Windows, the shared workflow:

- Enables the Vulkan feature.
- Installs and validates Vulkan SDK `1.4.309.0`.
- Applies the portable CMake hook and `x86-64-v2` Rust target.
- Uses the `windows-portable-v1` cache prefix.
- Runs the pre-bundle Whisper verification.

For Linux builds, it can enable OpenBLAS. macOS uses Metal by default.

#### `build-devtest.yml` (Windows DevTest)

The Windows DevTest path applies the same portable CMake hook, Rust target, cache prefix, Vulkan setup, and pre-bundle verification as a release build. Keep those safeguards in place when changing DevTest behavior.

#### `build-windows.yml` (Standalone Windows)

The standalone Windows workflow uses the Vulkan feature and applies the same portability safeguards before packaging. A change is incomplete if it updates only the shared workflow or only this standalone workflow.

### Verification

#### How to Verify a Windows Package Build

1. **Check the workflow configuration**
   - Windows build arguments include `--features vulkan`.
   - Vulkan SDK `1.4.309.0` is installed and validated.
   - `CMAKE_PROJECT_INCLUDE` uses the portable hook.
   - Rust uses `-C target-cpu=x86-64-v2`.

2. **Check native Whisper configuration**
   - `GGML_NATIVE` is OFF.
   - All four AVX-512 options are OFF.
   - The `verify-portable-ggml.cjs` command completes before bundling.

3. **Check cache isolation**
   - Windows builds use the `windows-portable-v1` cache prefix.
   - Do not reuse a native cache whose CPU configuration is unknown.

#### Runtime Verification

Confirm the packaged application runs on an AVX2-capable Windows computer without AVX-512. Treat non-AVX2 coverage as separate from this Whisper package baseline.

### Why Windows CI uses Vulkan instead of CUDA

CUDA needs compatible NVIDIA hardware, drivers, and the CUDA toolkit. The standard Windows package instead uses Vulkan so CI can produce one configured artifact without selecting CUDA for end users. Contributors who need CUDA should create a compatible source build.

### Troubleshooting portability

#### Build Fails with a Windows Vulkan Error

- Confirm the Vulkan SDK installation and environment-validation steps completed.
- Confirm the workflow still uses SDK `1.4.309.0`.
- pnpm installation does not install or repair the Vulkan SDK.

#### Portability Verification Fails

Treat the failure as a packaging blocker. Inspect the generated Whisper CMake cache and the portable cache prefix; do not bypass the pre-bundle verifier. A fresh portable build is safer than reusing a cache with unknown CPU flags.

#### CUDA Is Needed

Use a compatible NVIDIA source-build environment with the CUDA toolkit. The standard Windows installer intentionally remains the Vulkan build.

### Summary

- Windows packages use Vulkan-enabled Whisper, retain AVX2, and disable AVX-512.
- The portable CMake hook, Rust target, cache prefix, Vulkan setup, and pre-bundle verification work together; preserve them as a unit.
- CUDA remains an appropriately configured source-build option.
- Linux remains source-built; macOS uses Metal by default.

## Troubleshooting

| Problem | Check |
|---|---|
| Bundling fails with "A public key has been found, but no private key" | No `TAURI_SIGNING_PRIVATE_KEY` secret (always the case in this fork; TD-28) |
| Signing fails | All secrets for that platform are set and not expired; read the job log; try once with signing off |
| Windows MSI fails on the version | Use a numeric version in `tauri.conf.json` (`0.1.3`, not `0.1.2-pro-trial`) |
| Artifacts are missing | The run succeeded, `upload-artifacts` was on, and the retention period (14 or 30 days) has not passed |
| A workflow does not appear in Actions | The file is in `.github/workflows/`, ends in `.yml`/`.yaml` and is valid YAML |
