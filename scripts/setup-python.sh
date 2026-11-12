#!/bin/sh
# Install the interpreter, tooling, cache, and virtualenv inside this checkout.
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export UV_UNMANAGED_INSTALL="$PROJECT_ROOT/.tools/uv"
export UV_PYTHON_INSTALL_DIR="$PROJECT_ROOT/.python"
export UV_PYTHON_BIN_DIR="$PROJECT_ROOT/.tools/bin"
export UV_CACHE_DIR="$PROJECT_ROOT/.cache/uv"
export UV_NO_MODIFY_PATH=1
export UV_NO_SYSTEM_CONFIG=1
UV_BIN="$UV_UNMANAGED_INSTALL/uv"

if [ -e "$PROJECT_ROOT/.venv" ]; then
    if [ ! -x "$PROJECT_ROOT/.venv/bin/python" ] || ! "$PROJECT_ROOT/.venv/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 11)' 2>/dev/null; then
        echo 'An existing .venv is not Python 3.11. Move it aside before running setup; it has been left untouched.' >&2
        exit 1
    fi
    "$PROJECT_ROOT/.venv/bin/python" --version
    exit 0
fi

if [ ! -x "$UV_BIN" ]; then
    mkdir -p "$PROJECT_ROOT/.tools"
    INSTALLER=$(mktemp "$PROJECT_ROOT/.tools/uv-installer.XXXXXX")
    trap 'rm -f "$INSTALLER"' EXIT HUP INT TERM
    if ! curl --fail --silent --show-error --location --connect-timeout 10 --max-time 60 https://astral.sh/uv/install.sh --output "$INSTALLER"; then
        echo 'Could not download uv. Run this script from a terminal with network access.' >&2
        exit 1
    fi
    sh "$INSTALLER"
fi

"$UV_BIN" python install 3.11
"$UV_BIN" venv --managed-python --python 3.11 --seed "$PROJECT_ROOT/.venv"
"$PROJECT_ROOT/.venv/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 11); print(sys.version); print("Project interpreter:", sys.executable)'
echo 'Ready. Use .venv/bin/python, or activate with: source .venv/bin/activate'
