#!/usr/bin/env bash

new_legacy_validation_groups() {
  case "${1:-full}" in
    uat-fast)
      printf '%s\n' \
        frontend-contracts \
        integrated-core \
        practice-e2e \
        visual-regression
      ;;
    full)
      printf '%s\n' \
        backend-tests \
        frontend-contracts \
        extended-contracts \
        integrated-core \
        practice-e2e \
        cross-domain-e2e \
        visual-regression
      ;;
    *)
      echo "不支持的 new-legacy 验收级别：$1" >&2
      return 2
      ;;
  esac
}

new_legacy_validation_group_enabled() {
  local profile="$1" group="$2"
  new_legacy_validation_groups "$profile" | grep -Fxq "$group"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  new_legacy_validation_groups "${1:-full}"
fi
