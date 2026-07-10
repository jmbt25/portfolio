#!/usr/bin/env bash
#
# Integration tests for the content guard. Exercises the staged-blob read, the
# strict validator wired into the guard, the never-echo-content rule, and
# fail-closed exit-2 handling. Uses temporary entries it stages and cleans up.
#
# Exit: 0 all passed, 1 a test failed.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
G=".github/scripts/content-guard.sh"
V=".github/scripts/entry-validate.mjs"
DL="agent/denylist.txt"
TMP=()
fail=0
pass() { echo "  ok   $1"; }
bad() { echo "  FAIL $1"; fail=1; }
cleanup() {
  for f in "${TMP[@]:-}"; do git reset -q HEAD "$f" 2>/dev/null || true; rm -f "$f"; done
  [[ -f /tmp/denylist.guardtest.bak ]] && { cp /tmp/denylist.guardtest.bak "$DL"; rm -f /tmp/denylist.guardtest.bak; }
}
trap cleanup EXIT
mkentry() { TMP+=("$1"); cat > "$1"; git add "$1"; }

# 1. clean staged entry -> PASS
mkentry agent/entries/2099-12-30.json <<'J'
{"date":"2099-12-30","items":[{"id":"2099-12-30-a","kind":"quiet-day","headline":"nothing","body":"a quiet day, nothing for dota-deals","related_project":null,"confidence":0.0}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-30T00:00:00Z"}}
J
bash "$G" >/dev/null 2>&1 && pass "clean staged entry passes" || bad "clean staged entry should pass"
git reset -q HEAD agent/entries/2099-12-30.json; rm -f agent/entries/2099-12-30.json

# 2. dirty staged entry -> FAIL(1); sentinel content must NOT appear in output; pattern IS named
mkentry agent/entries/2099-12-31.json <<'J'
{"date":"2099-12-31","items":[{"id":"2099-12-31-a","kind":"improvement","source_title":"t","source_url":"https://simonwillison.net/x","source_name":"s","headline":"h","body":"Azure DevOps SENTINEL_LEAK_ZZZ appears here","related_project":"dota-deals","confidence":0.5}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-31T00:00:00Z"}}
J
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "dirty staged entry fails (exit 1)" || bad "dirty entry exit=$rc (want 1)"
grep -q SENTINEL_LEAK_ZZZ <<<"$out" && bad "SENTINEL content leaked into guard output" || pass "sentinel content not in output"
grep -q 'pattern=' <<<"$out" && pass "guard names the matched pattern" || bad "guard did not name a pattern"
git reset -q HEAD agent/entries/2099-12-31.json; rm -f agent/entries/2099-12-31.json

# 3. JSON escape + zero-width in a staged entry, caught end-to-end after parse+normalize
mkentry agent/entries/2099-12-27.json <<'J'
{"date":"2099-12-27","items":[{"id":"2099-12-27-a","kind":"improvement","source_title":"t","source_url":"https://simonwillison.net/x","source_name":"s","headline":"h","body":"a private repo and a vulner​ability","related_project":"dota-deals","confidence":0.5}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-27T00:00:00Z"}}
J
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "escape+zero-width entry fails" || bad "escape entry exit=$rc"
grep -q 'identity' <<<"$out" && pass "  caught escaped private repo (identity)" || bad "  missed escaped private repo"
grep -q 'vocabulary' <<<"$out" && pass "  caught zero-width vulnerability (vocabulary)" || bad "  missed zero-width vulnerability"
git reset -q HEAD agent/entries/2099-12-27.json; rm -f agent/entries/2099-12-27.json

# 4. staged-blob read is the index version, not the working tree
mkentry agent/entries/2099-12-29.json <<'J'
{"date":"2099-12-29","items":[{"id":"2099-12-29-a","kind":"quiet-day","headline":"clean","body":"clean staged body, dota-deals","related_project":null,"confidence":0.0}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-29T00:00:00Z"}}
J
cat > agent/entries/2099-12-29.json <<'J'
{"date":"2099-12-29","items":[{"id":"2099-12-29-a","kind":"improvement","source_title":"t","source_url":"https://simonwillison.net/x","source_name":"s","headline":"h","body":"Azure DevOps only in the working tree","related_project":"dota-deals","confidence":0.5}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-29T00:00:00Z"}}
J
sv="$(node "$V" --emit-values --source=staged agent/entries/2099-12-29.json 2>&1)"
wv="$(node "$V" --emit-values --source=worktree agent/entries/2099-12-29.json 2>&1)"
grep -q 'Azure DevOps' <<<"$sv" && bad "staged read saw the working-tree poison" || pass "staged read is the index blob (clean)"
grep -q 'Azure DevOps' <<<"$wv" && pass "worktree read sees the working-tree change" || bad "worktree read wrong"
git reset -q HEAD agent/entries/2099-12-29.json; rm -f agent/entries/2099-12-29.json

# 5. an enumeration/read error is exit 2 (fail closed), not an empty pass
bash "$G" --stdout /nonexistent/agent-run.log >/dev/null 2>&1; rc=$?
[[ $rc -eq 2 ]] && pass "missing stdout log -> exit 2" || bad "missing log exit=$rc (want 2)"

# 6. an invalid regex in the denylist makes grep exit 2 -> guard exit 2, not a pass
cp "$DL" /tmp/denylist.guardtest.bak
printf '[identity]\n[\n[repo-config]\nAGENT\\.md\n[vocabulary]\nvulnerab\n' > "$DL"
mkentry agent/entries/2099-12-28.json <<'J'
{"date":"2099-12-28","items":[{"id":"2099-12-28-a","kind":"quiet-day","headline":"h","body":"b for dota-deals","related_project":null,"confidence":0.0}],"meta":{"sources_checked":1,"sources_failed":0,"generated_at":"2099-12-28T00:00:00Z"}}
J
bash "$G" >/dev/null 2>&1; rc=$?
cp /tmp/denylist.guardtest.bak "$DL"; rm -f /tmp/denylist.guardtest.bak
git reset -q HEAD agent/entries/2099-12-28.json; rm -f agent/entries/2099-12-28.json
[[ $rc -eq 2 ]] && pass "invalid denylist regex -> exit 2" || bad "invalid regex exit=$rc (want 2)"

(( fail )) && { echo "guard-test: FAILURES"; exit 1; }
echo "guard-test: all passed"
exit 0
