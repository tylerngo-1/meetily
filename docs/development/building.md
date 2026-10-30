# Building Meetily from Source

How to build and run the Tauri app on macOS, Windows and Linux, and how GPU acceleration is chosen.
Commands run from `frontend/` unless stated otherwise. For a short version, see the root
[AGENTS.md](../../AGENTS.md#commands).

## 1. Prerequisites

All platforms:

- **Rust** (stable) from [rustup.rs](https://rustup.rs/)
- **Node.js 20** (the version CI uses)
- **pnpm 9.15.9**: `npm install -g pnpm@9.15.9`
- **CMake** (whisper.cpp and llama.cpp are compiled from source)
- Network access on the first build: Cargo downloads crates and `build.rs` downloads `ffmpeg`

| OS | Also install |
|---|---|
| macOS | Xcode Command Line Tools (`xcode-select --install`); `brew install cmake node` |
| Windows (10 or later) | Visual Studio Build Tools with the "Desktop development with C++" workload; [CMake](https://cmake.org/download/) |
| Linux | A C/C++ toolchain, CMake, git, and Tauri's system libraries (below) |

Linux packages, Ubuntu/Debian (the list CI uses in `.github/workflows/build-devtest.yml`):

```bash
sudo apt update
sudo apt install build-essential cmake git \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libasound2-dev libopenblas-dev libx11-dev libxtst-dev libxrandr-dev
```

Fedora (`sudo dnf install gcc-c++ cmake git`) and Arch (`sudo pacman -S base-devel cmake git`) need
the equivalent WebKitGTK 4.1, AppIndicator, librsvg and ALSA development packages; see Tauri's
[Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

Install the JavaScript dependencies (never update the lockfile unless you are changing dependencies):

```bash
cd frontend
pnpm install --frozen-lockfile
```

## 2. First build

The app bundles two sidecar binaries (`externalBin` in `src-tauri/tauri.conf.json`):

- **`ffmpeg`**: downloaded automatically by `src-tauri/build.rs`.
- **`llama-helper`**: the built-in summary model runner (`llama-helper/` crate). It must be **built
  and copied** to `src-tauri/binaries/llama-helper-<target-triple>` (gitignored) before the first
  Rust build; otherwise the build fails with "`binaries/llama-helper-<target>` does not exist" (TD-09).

The GPU scripts build the sidecar with matching GPU features, copy it into place, then start the app:

```bash
./dev-gpu.sh        # macOS / Linux: debug sidecar + pnpm run tauri:dev
dev-gpu.bat         # Windows
```

Or build it by hand from the repository root (add `--features metal` on macOS for GPU inference,
`cuda` or `vulkan` elsewhere; add `.exe` to both file names on Windows):

```bash
cargo build -p llama-helper --release
cp target/release/llama-helper "frontend/src-tauri/binaries/llama-helper-$(rustc -vV | sed -n 's/host: //p')"
```

After that, the normal commands work. Rebuild the sidecar when `llama-helper/` changes.

## 3. Everyday commands

| Command | What it does |
|---|---|
| `pnpm run tauri:dev` | Full app in dev mode with GPU auto-detection; uses `tauri.dev.conf.json` (app identifier `com.meetily.ai.dev`, separate data folder) |
| `pnpm run tauri:build` | Production build with GPU auto-detection |
| `pnpm run tauri:dev:<feature>` / `tauri:build:<feature>` | Force a feature: `cpu`, `metal`, `coreml`, `cuda`, `vulkan`, `hipblas`, `openblas` |
| `pnpm run dev` | Next.js UI only at `http://localhost:3118`; every Tauri `invoke` fails in a plain browser |
| `pnpm run tauri:dev` | Rust logs print to this terminal, `info` and above only; `RUST_LOG` currently has no effect ([logging.md](logging.md), TD-32) |

Tauri runs `pnpm dev` (port 3118) before `tauri dev`, and `pnpm build` (static export to
`frontend/out`) before `tauri build`.

## 4. How GPU acceleration is chosen

GPU features only affect **Whisper** (and the `llama-helper` sidecar when the scripts build it).
Parakeet always runs on the CPU through ONNX Runtime.

`pnpm run tauri:dev` / `tauri:build` run `scripts/tauri-auto.js`, which uses `TAURI_GPU_FEATURE` if
it is set to a non-empty value, otherwise `scripts/auto-detect-gpu.js`, and passes the result as
`-- --features <feature>`. Detection:

| OS | Check, in order | Feature |
|---|---|---|
| macOS | Apple Silicon (`arm64`) | `coreml` |
| | Intel | `metal` |
| Windows, Linux | `nvidia-smi` exists **and** (`CUDA_PATH` set or `nvcc` found) | `cuda` |
| Linux | `rocm-smi` exists **and** (`ROCM_PATH` set or `hipcc` found) | `hipblas` |
| Windows, Linux | `vulkaninfo` exists (or `C:\VulkanSDK` on Windows) **and** `VULKAN_SDK` **and** `BLAS_INCLUDE_DIRS` set | `vulkan` |
| Windows, Linux | `BLAS_INCLUDE_DIRS` set | `openblas` |
| any | nothing above | none (CPU) |

Things to know:

- **Drivers alone are not enough.** CUDA, ROCm and Vulkan need their development SDKs.
- **Detection stops at the first GPU it sees.** An NVIDIA GPU without the CUDA toolkit, or an AMD
  GPU without ROCm, falls back to CPU instead of trying Vulkan (TD-08).
- **macOS always gets Metal and CoreML** for Whisper: `Cargo.toml` enables them for macOS targets
  regardless of the feature passed, so `cpu`/`none` does not remove them on a Mac.
- **`llama-helper` supports only `metal`, `cuda` and `vulkan`.** The scripts build it with `metal`
  when Whisper uses `coreml`, but pass `hipblas` and `openblas` through unchanged, so the sidecar
  build **fails** on ROCm or OpenBLAS machines (TD-26). Workaround: build the sidecar by hand without
  features (section 2), then run `pnpm run tauri:dev`.
- On Linux with CUDA, `tauri-auto.js`, `dev-gpu.sh` and `build-gpu.sh` set
  `CMAKE_CUDA_ARCHITECTURES=75`, `CMAKE_CUDA_STANDARD=17` and `CMAKE_POSITION_INDEPENDENT_CODE=ON`,
  **overwriting any value you set** (TD-07).

### Forcing a backend

```bash
TAURI_GPU_FEATURE=vulkan pnpm run tauri:dev    # also works with ./dev-gpu.sh and ./build-gpu.sh
TAURI_GPU_FEATURE=none pnpm run tauri:dev      # CPU only
pnpm run tauri:dev:cuda                        # explicit script, no detection
```

`TAURI_GPU_FEATURE=""` does **not** force CPU; an empty value runs auto-detection (TD-06).

## 5. GPU setup (Linux and Windows)

| Backend | Feature | GPUs | Requirements |
|---|---|---|---|
| CUDA | `cuda` | NVIDIA, compute capability 5.0+ | Driver + CUDA toolkit (`nvcc`) |
| ROCm | `hipblas` | AMD with ROCm support (Linux only) | ROCm (`rocm-smi`, `hipcc`) |
| Vulkan | `vulkan` | NVIDIA, AMD, Intel | Vulkan SDK + BLAS headers |
| OpenBLAS | `openblas` | CPU (optimized math) | OpenBLAS headers |

### NVIDIA CUDA

```bash
sudo apt install nvidia-driver-550 nvidia-cuda-toolkit    # Ubuntu/Debian, CUDA 12.x
nvidia-smi                                                # GPU visible
nvcc --version                                            # toolkit installed
nvidia-smi --query-gpu=compute_cap --format=csv           # e.g. 8.6
./build-gpu.sh
```

whisper.cpp uses `CMAKE_CUDA_ARCHITECTURES` to target your GPU (compute capability without the dot:
`7.5` → `75`, `8.6` → `86`). The scripts currently force `75` (TD-07); code built for 7.5 runs on newer
GPUs but is not tuned for them. On Windows, install the CUDA toolkit (it sets `CUDA_PATH`) and run
`dev-gpu.bat` or `pnpm run tauri:dev`.

### Vulkan

```bash
sudo apt install vulkan-sdk libopenblas-dev        # Ubuntu/Debian, after adding LunarG's apt repository (below)
sudo dnf install vulkan-devel openblas-devel       # Fedora
sudo pacman -S vulkan-devel openblas               # Arch

export VULKAN_SDK=/usr                              # add both to ~/.bashrc or ~/.zshrc
export BLAS_INCLUDE_DIRS=/usr/include/x86_64-linux-gnu
./build-gpu.sh
```

Ubuntu does not ship a `vulkan-sdk` package; add LunarG's repository first, as CI does
(`.github/workflows/build-devtest.yml`, "Prepare Vulkan SDK"), or follow
[LunarG's instructions](https://vulkan.lunarg.com/sdk/home#linux).

On Windows, install the [Vulkan SDK](https://vulkan.lunarg.com/) (its installer sets `VULKAN_SDK`).
Auto-detection also requires `BLAS_INCLUDE_DIRS`, which the installer does not set; either set it or
skip detection with `pnpm run tauri:dev:vulkan` (build the sidecar with `--features vulkan` by hand).

### AMD ROCm (Linux)

```bash
# Add the ROCm repository first: https://rocm.docs.amd.com
sudo apt install rocm-smi hipcc
export ROCM_PATH=/opt/rocm
rocm-smi && hipcc --version
./build-gpu.sh
```

### Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `TAURI_GPU_FEATURE` | Force a feature (`none` = CPU) | `vulkan` |
| `CUDA_PATH` | CUDA install directory (detection) | `/usr/local/cuda` |
| `ROCM_PATH` | ROCm install directory (detection) | `/opt/rocm` |
| `VULKAN_SDK` | Vulkan SDK directory (detection) | `/usr` |
| `BLAS_INCLUDE_DIRS` | BLAS headers (Vulkan and OpenBLAS detection) | `/usr/include/x86_64-linux-gnu` |
| `CMAKE_CUDA_ARCHITECTURES` | CUDA target (overwritten by the scripts, TD-07) | `86` |
| `NO_STRIP` | Keep symbols in the AppImage (set by `build-gpu.sh`) | `true` |

## 6. Production builds

```bash
./build-gpu.sh        # macOS / Linux: release sidecar + tauri:build (sets NO_STRIP=true)
build-gpu.bat         # Windows
pnpm run tauri:build  # if the sidecar is already in src-tauri/binaries/
```

Bundles are written to `target/release/bundle/` at the **repository root** (the Cargo workspace
root), one folder per target in `tauri.conf.json`: `macos/` (`meetily.app`) and `dmg/`; `msi/` and `nsis/`;
`deb/` and `appimage/`.

- **Updater signing key:** `tauri.conf.json` turns on updater artifacts (`createUpdaterArtifacts`), so
  the build fails (exit code 1) with "A public key has been found, but no private key" unless
  `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) is set. This fork has no
  key (TD-28). The bundles are written first, but the command still fails, so scripts stop there.
  `pnpm run tauri:build` and `build-gpu.sh` do not pass extra arguments on, so for a
  local build without a key call the Tauri CLI directly with the config `install_local.sh` uses,
  which turns updater artifacts off (build the sidecar first, see [First build](#2-first-build)):
  ```bash
  pnpm tauri build --config src-tauri/tauri.local.conf.json            # add -- --features <feature> if needed
  ```
  To use a key instead, copy `frontend/.env.example` to `frontend/.env` (gitignored); `build.ps1`
  loads it on Windows.
- Linux: `NO_STRIP=true` prevents runtime errors caused by stripped symbols in the AppImage.
- To install a build over the daily-use app on this fork's Mac, use `install_local.sh` as described
  in [local-workflow.md](local-workflow.md#installing-to-the-daily-app); do not copy bundles by hand.

### Windows distribution builds

The commands above create a local source build. Use the production Windows build workflow for an installer intended for other computers: it enables Vulkan. Rust targets `x86-64-v2`; native Whisper retains AVX2 with host-native specialization and AVX-512 disabled.

The distribution workflows (`build.yml`, `build-windows.yml`, and `build-devtest.yml`) set `CMAKE_PROJECT_INCLUDE` to `.github/force-portable-ggml.cmake`, which forces `GGML_NATIVE=OFF`, and use `RUSTFLAGS=-C target-cpu=x86-64-v2`. The hook configures Whisper's native C/C++ build; Rust flags do not. `WHISPER_NATIVE=OFF` and plain `GGML_*` variables are not replacements.

Windows packages therefore require an AVX2-capable x64 CPU (AVX-512 is not required). The standard
Windows installer does not use CUDA; CUDA needs a source build with the CUDA toolkit.

## 7. Build scripts

All in `frontend/`.

| Script | Does | Builds `llama-helper` | Notes |
|---|---|---|---|
| `dev-gpu.sh` / `dev-gpu.bat` | GPU detection + debug sidecar + `tauri:dev` | Yes (debug) | Recommended first run. `.sh` is macOS/Linux only |
| `build-gpu.sh` / `build-gpu.bat` | GPU detection + release sidecar + `tauri:build` | Yes (release) | `.sh` sets `NO_STRIP=true` |
| `clean_run.sh [log level]` | `pnpm install`, then `tauri dev` with the dev config, no GPU feature | No | macOS/Linux; the log level sets `RUST_LOG`, which has no effect (TD-32) |
| `clean_build.sh [log level]` | Installs CMake via Homebrew if missing, cleans, `pnpm install`, `tauri build` | No | macOS; deletes `src-tauri/target`, which is no longer the build folder (TD-25) |
| `clean_run_windows.bat` / `clean_build_windows.bat` | `tauri dev` (dev config) / `tauri build` | No | Windows |
| `build.bat` | Sets environment, then `tauri:dev:vulkan` or `tauri:build:vulkan` | No | Windows |
| `dev-gpu.ps1` / `build-gpu.ps1` | PowerShell: run `tauri:dev:vulkan` / `tauri:build:vulkan` | No | Windows |
| `build.ps1` | Loads signing variables from `frontend/.env` (via `scripts/load-env.ps1`) if not set, then runs `build-gpu.bat` | Yes (via `build-gpu.bat`) | Windows signed build; needs `TAURI_SIGNING_PRIVATE_KEY` |
| `build_backup.bat`, `package-app.sh` | Older build scripts | No | Stale (TD-25) |
| `install_local.sh` | Builds and installs over `/Applications/meetily.app` with backups | No | This fork's daily-use install; never run without being asked |

`clean_run.sh` and `clean_build.sh` install with plain `pnpm install`, not `--frozen-lockfile` (TD-10).

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `binaries/llama-helper-<target> does not exist` | Build the sidecar once (section 2) |
| `dev-gpu.sh` fails building `llama-helper`: "does not have the feature `hipblas`" (or `openblas`) | Known bug (TD-26); build the sidecar by hand without features |
| "NVIDIA GPU detected but CUDA not installed" | Install the CUDA toolkit or set `CUDA_PATH`; `nvcc --version` must work |
| "Vulkan detected but missing dependencies" | Set both `VULKAN_SDK` and `BLAS_INCLUDE_DIRS` |
| Builds but no GPU acceleration | Read the detection lines at the start of the build output; install the SDK, not just the driver; or force a feature (section 4) |
| AppImage fails at runtime with missing symbols | Build with `NO_STRIP=true` (`build-gpu.sh` does this) |
| Windows: compiler or linker errors | Check the Visual Studio "Desktop development with C++" workload and CMake are installed |
| macOS: `permission denied` running a script | `chmod +x dev-gpu.sh build-gpu.sh clean_run.sh clean_build.sh` |
| No microphone or system audio | Grant microphone, screen recording and audio capture permissions (macOS System Settings → Privacy & Security; Windows privacy settings → Microphone). |
