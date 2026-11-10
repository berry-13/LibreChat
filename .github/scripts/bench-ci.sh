#!/usr/bin/env bash
# CI benchmark driver: GitHub-hosted runners against Avrea runners.
#
# Two branches hold the same commit of the code and differ only in runner labels
# (bench/github keeps ubuntu-latest, bench/avrea uses avrea-* labels). This script
# dispatches the same workflows on both and turns the run timings into a table.
# Nothing here publishes: see the BENCHMARK BRANCH note in docker-publish.yml, and the
# npm workflows only publish from refs/heads/main.
#
#   bench-ci.sh probe                    run the hardware probe on every runner label
#   bench-ci.sh dispatch [name-filter]   one pass of every workflow on both branches
#   bench-ci.sh status                   state of the benchmark runs
#   bench-ci.sh report [jobs.csv]        timing tables (markdown), optional per-job CSV
#
# Pass 1 on a branch is the cold-cache run, later passes are warm. Dispatch a pass,
# wait until `status` shows nothing in progress, then dispatch the next one: most
# workflows cancel an in-flight run on the same branch.
set -euo pipefail

REPO="${BENCH_REPO:-berry-13/LibreChat}"
REF_GITHUB="${BENCH_REF_GITHUB:-bench/github}"
REF_AVREA="${BENCH_REF_AVREA:-bench/avrea}"
EVENT="${BENCH_EVENT:-workflow_dispatch}"

# "<workflow file>[ <extra gh workflow run args>]"
WORKFLOWS=(
  "backend-review.yml"
  "frontend-review.yml"
  "static-checks.yml"
  "cache-integration-tests.yml"
  "agents-integration-tests.yml"
  "playwright-mock.yml -f coverage=pr"
  "docker-smoke.yml"
  "dev-branch-images.yml"
  "data-provider.yml"
  "data-schemas.yml"
  "client.yml"
)

list_runs() { # <ref> -> one JSON object per run
  gh api --paginate "repos/$REPO/actions/runs?branch=$1&event=$EVENT&per_page=100" \
    -q '.workflow_runs[] | {id, path, name, status, conclusion, created_at, run_attempt}'
}

active_runs() { # <ref> -> count of runs not yet completed
  list_runs "$1" | jq -s '[.[] | select(.status != "completed")] | length'
}

cmd_dispatch() {
  local filter="${1:-}" ref entry file
  for ref in "$REF_GITHUB" "$REF_AVREA"; do
    if [ "$(active_runs "$ref")" -ne 0 ]; then
      echo "Runs are still in progress on $ref; wait for them (bench-ci.sh status) before the next pass." >&2
      exit 1
    fi
  done
  for entry in "${WORKFLOWS[@]}"; do
    file="${entry%% *}"
    case "$file" in *"$filter"*) ;; *) continue ;; esac
    for ref in "$REF_GITHUB" "$REF_AVREA"; do
      echo "dispatch $file on $ref"
      # shellcheck disable=SC2086 # extra args are a fixed, space-separated list from WORKFLOWS
      gh workflow run "$file" -R "$REPO" --ref "$ref" ${entry#"$file"}
    done
  done
}

cmd_status() {
  local ref
  for ref in "$REF_GITHUB" "$REF_AVREA"; do
    echo "== $ref"
    list_runs "$ref" | jq -rs 'sort_by(.created_at) | .[]
      | "\(.created_at)  \(.status)/\(.conclusion // "-")  \(.path | sub(".github/workflows/"; ""))  run \(.id)"'
  done
  echo "== Actions cache in use on GitHub (10 GB cap per repository)"
  gh api "repos/$REPO/actions/cache/usage" \
    -q '"\(.active_caches_count) entries, \(.active_caches_size_in_bytes / 1073741824 * 100 | round / 100) GiB"'
}

collect() { # <provider> <ref> -> one JSON object per finished job
  local provider="$1" ref="$2" run
  list_runs "$ref" | jq -c 'select(.status == "completed")' | while IFS= read -r run; do
    gh api --paginate "repos/$REPO/actions/runs/$(jq -r .id <<<"$run")/jobs?per_page=100" -q '.jobs[]' |
      jq -c --arg provider "$provider" --argjson run "$run" '
        select(.conclusion == "success" or .conclusion == "failure")
        | select(.started_at != null and .completed_at != null)
        | { provider: $provider,
            workflow: ($run.path | sub(".github/workflows/"; "")),
            run_id: $run.id, run_created: $run.created_at,
            job: .name, conclusion,
            labels: (.labels | join("+")),
            queue_s: ((.started_at | fromdateiso8601) - ((.created_at // .started_at) | fromdateiso8601)),
            run_s: ((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)),
            end_s: ((.completed_at | fromdateiso8601) - ($run.created_at | fromdateiso8601)) }'
  done
}

cmd_report() {
  local csv="${1:-}" jobs
  jobs="$( { collect github "$REF_GITHUB"; collect avrea "$REF_AVREA"; } | jq -s '
    # Number the runs of each workflow per provider: pass 1 is the cold run.
    group_by([.provider, .workflow])
    | map((map(.run_id) | unique) as $ids
          | map(. + { pass: (.run_id as $r | ($ids | index($r)) + 1) }))
    | add // []')"

  if [ "$(jq 'length' <<<"$jobs")" -eq 0 ]; then
    echo "No completed benchmark runs on $REF_GITHUB or $REF_AVREA yet." >&2
    exit 1
  fi

  if [ -n "$csv" ]; then
    jq -r '["provider","workflow","pass","run_id","job","conclusion","labels","queue_s","run_s"],
      (.[] | [.provider, .workflow, .pass, .run_id, .job, .conclusion, .labels, .queue_s, .run_s]) | @csv' \
      <<<"$jobs" >"$csv"
    echo "wrote $csv" >&2
  fi

  jq -r '
    def mmss: if . == null then "-" else "\(. / 60 | floor)m\(. % 60 | floor | tostring | if length < 2 then "0" + . else . end)s" end;
    def median: sort | if length == 0 then null else .[(length - 1) / 2 | floor] end;
    def ratio($a; $b): if $a == null or $b == null or $b == 0 then "-" else "\($a / $b * 100 | round / 100)x" end;
    # cold = pass 1, warm = median over later passes
    def phase($rows; $provider; $cold; f):
      [$rows[] | select(.provider == $provider and (if $cold then .pass == 1 else .pass > 1 end))]
      | group_by(.run_id) | map(f) | median;
    def cells($rows; f):
      phase($rows; "github"; true; f) as $gc | phase($rows; "avrea"; true; f) as $ac
      | phase($rows; "github"; false; f) as $gw | phase($rows; "avrea"; false; f) as $aw
      | "\($gc | mmss) | \($ac | mmss) | \(ratio($gc; $ac)) | \($gw | mmss) | \($aw | mmss) | \(ratio($gw; $aw))";

    . as $all
    | "## Per workflow\n",
      "Wall clock is dispatch to last job finished (includes queueing). Runner time is the sum of job durations.",
      "Speedup is GitHub divided by Avrea. Warm is the median of every pass after the first.\n",
      "| Workflow | Metric | GitHub cold | Avrea cold | Speedup | GitHub warm | Avrea warm | Speedup |",
      "|---|---|---|---|---|---|---|---|",
      ($all | group_by(.workflow)[] | . as $rows
        | "| \($rows[0].workflow) | wall clock | \(cells($rows; map(.end_s) | max)) |",
          "| | runner time | \(cells($rows; map(.run_s) | add)) |",
          "| | slowest pickup | \(cells($rows; map(.queue_s) | max)) |"),
      "\n## Per job (job duration only)\n",
      "| Workflow | Job | GitHub cold | Avrea cold | Speedup | GitHub warm | Avrea warm | Speedup |",
      "|---|---|---|---|---|---|---|---|",
      ($all | group_by([.workflow, .job])[] | . as $rows
        | "| \($rows[0].workflow) | \($rows[0].job)\(if any($rows[]; .conclusion == "failure") then " (has failed runs)" else "" end) | \(cells($rows; map(.run_s) | add)) |"),
      "\n## Runs counted\n",
      ($all | group_by(.provider)[] | "- \(.[0].provider): \(map(.run_id) | unique | length) runs, \(length) jobs, labels: \(map(.labels) | unique | join(", "))")
  ' <<<"$jobs"
}

cmd_probe() {
  # bench-runner-probe.yml starts on a push to bench/probe. Moving that branch between
  # the two benchmark heads is a push, and it never touches the benchmark branches.
  local github_sha avrea_sha current target
  github_sha="$(gh api "repos/$REPO/git/ref/heads/$REF_GITHUB" -q .object.sha)"
  avrea_sha="$(gh api "repos/$REPO/git/ref/heads/$REF_AVREA" -q .object.sha)"
  current="$(gh api "repos/$REPO/git/ref/heads/bench/probe" -q .object.sha 2>/dev/null || true)"
  target="$avrea_sha"
  if [ "$current" = "$avrea_sha" ]; then target="$github_sha"; fi
  if [ -z "$current" ]; then
    gh api -X POST "repos/$REPO/git/refs" -f ref=refs/heads/bench/probe -f sha="$target" -q .object.sha
  else
    gh api -X PATCH "repos/$REPO/git/refs/heads/bench/probe" -f sha="$target" -F force=true -q .object.sha
  fi
  echo "bench/probe moved; the probe run appears under: gh run list -R $REPO -b bench/probe"
}

case "${1:-}" in
  probe) cmd_probe ;;
  dispatch) shift; cmd_dispatch "$@" ;;
  status) cmd_status ;;
  report) shift; cmd_report "$@" ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
