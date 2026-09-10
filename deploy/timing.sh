#!/usr/bin/env bash
# Shared by deploy and validation entry points. Call finish from the owner's EXIT
# trap so existing database/temp-file cleanup and the original exit code survive.
deployment_timing_start() {
  DEPLOY_TIMING_SCOPE="$1"
  DEPLOY_TIMING_STARTED=$SECONDS
  DEPLOY_TIMING_STAGE_STARTED=$SECONDS
  DEPLOY_TIMING_STAGE=""
}

deployment_timing_stage() {
  if [ -n "$DEPLOY_TIMING_STAGE" ]; then
    printf 'TIMING scope=%s stage=%s seconds=%s status=0\n' \
      "$DEPLOY_TIMING_SCOPE" "$DEPLOY_TIMING_STAGE" "$((SECONDS - DEPLOY_TIMING_STAGE_STARTED))" >&2
  fi
  DEPLOY_TIMING_STAGE="$1"
  DEPLOY_TIMING_STAGE_STARTED=$SECONDS
  printf 'STAGE scope=%s stage=%s\n' "$DEPLOY_TIMING_SCOPE" "$DEPLOY_TIMING_STAGE" >&2
}

deployment_timing_finish() {
  local status="$1"
  if [ -n "$DEPLOY_TIMING_STAGE" ]; then
    printf 'TIMING scope=%s stage=%s seconds=%s status=%s\n' \
      "$DEPLOY_TIMING_SCOPE" "$DEPLOY_TIMING_STAGE" "$((SECONDS - DEPLOY_TIMING_STAGE_STARTED))" "$status" >&2
  fi
  printf 'TIMING scope=%s stage=total seconds=%s status=%s\n' \
    "$DEPLOY_TIMING_SCOPE" "$((SECONDS - DEPLOY_TIMING_STARTED))" "$status" >&2
}
