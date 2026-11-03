#!/usr/bin/env bash
# usage: bench.sh <reps>  ; runs warm/nowarm alternately for each paths file
set -uo pipefail
reps="${1:-3}"
export OPENCLAW_CI_DOCS_ONLY=false OPENCLAW_CI_DOCS_CHANGED=true OPENCLAW_CI_DOCS_ROOT_PROSE_ONLY=false OPENCLAW_CI_RUN_NODE=true \
  OPENCLAW_CI_NODE_TEST_DATA_ONLY=false OPENCLAW_CI_NODE_SELECTION= OPENCLAW_CI_RUN_MACOS=false OPENCLAW_CI_RUN_MACOS_NODE=true \
  OPENCLAW_CI_RUN_IOS_BUILD=false OPENCLAW_CI_RUN_IOS_SCREENSHOTS=false OPENCLAW_CI_RUN_ANDROID_SCREENSHOTS=false OPENCLAW_CI_RUN_ANDROID=false \
  OPENCLAW_CI_RUN_WINDOWS=true OPENCLAW_CI_RUN_NODE_FAST_ONLY=false OPENCLAW_CI_RUN_NODE_FAST_PLUGIN_CONTRACTS=false OPENCLAW_CI_RUN_NODE_FAST_CI_ROUTING=false \
  OPENCLAW_CI_RUN_SKILLS_PYTHON=false OPENCLAW_CI_RUN_CONTROL_UI_I18N=false OPENCLAW_CI_RUN_UI_TESTS=true OPENCLAW_CI_UI_E2E_FULL=false \
  OPENCLAW_CI_IOS_SIMULATOR_FULL=false OPENCLAW_CI_EXTENSION_LINT_FULL=false OPENCLAW_CI_RUN_NATIVE_I18N=true \
  OPENCLAW_CI_CHANGED_BASE=271d16a69b623d68f1cf6bdcf6da7bc304dbe58b OPENCLAW_CI_CORRECTION_BASE_SHA= OPENCLAW_CI_HISTORICAL_TARGET=false \
  OPENCLAW_CI_RELEASE_GATE=false OPENCLAW_CI_RELEASE_FAST_LANE_LABEL=false OPENCLAW_CI_RELEASE_SCOPE=full OPENCLAW_CI_VALIDATION_TIER=full \
  OPENCLAW_CI_PULL_REQUEST_NUMBER= OPENCLAW_CI_TARGET_REF= OPENCLAW_CI_TARGET_CONTEXT_REF= OPENCLAW_CI_HISTORICAL_TARGET_TAG= \
  OPENCLAW_CI_RELEASE_CANDIDATE_TARGET=false OPENCLAW_CI_TARGET_CONTEXT_TARGET=false OPENCLAW_CI_REPOSITORY=uuid-rocks/openclaw \
  OPENCLAW_CI_EVENT_NAME=pull_request OPENCLAW_CI_TEST_RUNTIME_POLICY= OPENCLAW_CI_RUNNER_PROFILE=hybrid OPENCLAW_CI_NODE_RUNNER_BACKEND=hybrid \
  OPENCLAW_CI_QUALIFICATION=false OPENCLAW_CI_SHAPE=default OPENCLAW_CI_RUNNER_BACKEND=hybrid OPENCLAW_CI_HOSTED_HEALTHY=false \
  OPENCLAW_CI_HEAD_REPOSITORY=uuid-rocks/openclaw OPENCLAW_CI_PR_AUTHOR_TYPE=User OPENCLAW_CI_FULL=false
export OPENCLAW_CI_CHECKOUT_REVISION="$(git rev-parse HEAD)" OPENCLAW_CI_WORKFLOW_REVISION="$(git rev-parse HEAD)"
export GITHUB_EVENT_NAME=pull_request
out="$(mktemp -d)"
run() { # variant pathsfile
  local script=scripts/ci-build-manifest.mjs; [ "$1" = nowarm ] && script=scripts/ci-build-manifest-nowarm.mjs
  local p=".github/zz-review/$2"
  OPENCLAW_CI_CHANGED_PATHS_JSON="$(cat "$p")" OPENCLAW_CI_CHANGED_PATHS_FILE= GITHUB_OUTPUT="$out/o-$1-$2" GITHUB_STEP_SUMMARY="$out/s" \
    /usr/bin/time -f "%e %U %M" -o "$out/t" node "$script" >"$out/log-$1-$2" 2>&1; local rc=$?
  echo "RESULT variant=$1 paths=$2 rc=$rc wall_user_maxrsskb=$(cat "$out/t" | tail -1)"
}
run warm paths-pr2.json >/dev/null  # page-cache warmup
for p in paths-pr2.json paths-125925208616.json paths-125952693002.json paths-125945861573.json; do
  for i in $(seq "$reps"); do
    if (( i % 2 )); then run warm "$p"; run nowarm "$p"; else run nowarm "$p"; run warm "$p"; fi
  done
  cmp -s <(grep -v '^$' "$out/o-warm-$p" | sort) <(grep -v '^$' "$out/o-nowarm-$p" | sort) && echo "OUTPUTS identical for $p" || { echo "OUTPUTS DIFFER for $p"; diff <(sort "$out/o-warm-$p") <(sort "$out/o-nowarm-$p") | head -5; }
done
tail -3 "$out/log-warm-paths-pr2.json"
