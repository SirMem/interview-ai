#!/usr/bin/env bash
# Start the audio transcriber service
# Usage: ./transcriber/start.sh [model_size]
#   model_size: tiny | base (default) | small | medium | large

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL="${1:-base}"
export WHISPER_MODEL="$MODEL"

# Create venv if it doesn't exist
if [ ! -d venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv venv
fi

# Install/update dependencies
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -q -r requirements.txt

echo "Starting transcriber (model=$MODEL)..."
venv/bin/python main.py
