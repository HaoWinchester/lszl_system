#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ -x .venv/bin/python ]]; then
  exec .venv/bin/python -m operator_app serve "$@"
else
  exec python3 -m operator_app serve "$@"
fi
