#!/usr/bin/env bash
#
# Self-test for the identity tripwire. Every probe exercises SCANNING behavior;
# there is no config file to parse, so there are no parser tests.
#   negative: legitimate lowercase content (src/content/skills.md, agent.md) must
#             PASS. These are the false positives the case-sensitive split avoids.
#   (a) path: an empty agent/scout.yml, and every workflow-name capitalization and
#             .yml/.yaml spelling, must FAIL. Ordinary machinery names stay
#             case-sensitive. An exact-ONLY probe proves the EXACT_PATTERNS scan
#             works on its own, not just when a path also matches WORKFLOW_PATTERNS.
#   (b) content: "private repo" fails without echoing the surrounding content.
#
# Prints its own assertion total; the count is machine-derived, not hand-asserted.
# Exit: 0 all passed, 1 a test failed.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
G=".github/scripts/content-guard.sh"
pass_n=0; fail_n=0
pass() { echo "  ok   $1"; pass_n=$((pass_n + 1)); }
bad()  { echo "  FAIL $1"; fail_n=$((fail_n + 1)); }
# Each workflow-case probe gets its own directory. Scout.yml / SCOUT.yml /
# scout.YML share one basename, and a case-insensitive filesystem (NTFS, APFS)
# treats them as the same path, which corrupts the index if they are staged in
# one tree. Distinct directories keep them distinct paths everywhere.
WF_PROBES=(src/p1/Scout.yml src/p2/SCOUT.yml src/p3/scout.YML src/p4/scout.yaml \
  src/p5/Reviewer.yml src/p6/reviewer.yaml src/p7/nested/dir/Scout.YML)
NEG_PROBES=(src/content/skills.md src/content/agent.md)
# agent-ci-settings.json matches an EXACT_PATTERNS entry and CANNOT match
# WORKFLOW_PATTERNS (no scout/reviewer basename), unlike agent/scout.yml which
# matches both. It proves the case-sensitive scan stands on its own.
EXACT_ONLY_PROBE=agent/agent-ci-settings.json
ALL_PROBES=(agent/scout.yml "$EXACT_ONLY_PROBE" src/_tripwire_probe.txt "${NEG_PROBES[@]}" "${WF_PROBES[@]}")
cleanup() {
  git reset -q HEAD "${ALL_PROBES[@]}" 2>/dev/null || true
  rm -f "${ALL_PROBES[@]}"
  rm -rf src/p1 src/p2 src/p3 src/p4 src/p5 src/p6 src/p7 src/content
  rmdir agent 2>/dev/null || true
}
trap cleanup EXIT
stage()   { mkdir -p "$(dirname "$1")"; : > "$1"; git add "$1"; }
unstage() { git reset -q HEAD "$1"; rm -f "$1"; }

# clean tree passes
bash "$G" >/dev/null 2>&1 && pass "clean tree passes" || bad "clean tree should pass"

# negative: legitimate lowercase content must NOT be flagged
for probe in "${NEG_PROBES[@]}"; do
  stage "$probe"
  bash "$G" >/dev/null 2>&1 && pass "negative: $probe passes" || bad "negative: $probe wrongly flagged"
  unstage "$probe"
done
rm -rf src/content 2>/dev/null || true

# (a) path regression: empty agent/scout.yml
stage agent/scout.yml
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(a) empty agent/scout.yml fails" || bad "(a) exit=$rc (want 1)"
grep -q 'agent/scout.yml' <<<"$out" && pass "(a)   names the path" || bad "(a)   did not name the path"
unstage agent/scout.yml; rmdir agent 2>/dev/null || true

# (a) every workflow-name capitalization and .yml/.yaml spelling must fail
for probe in "${WF_PROBES[@]}"; do
  stage "$probe"
  out="$(bash "$G" 2>&1)"; rc=$?
  [[ $rc -eq 1 ]] && pass "(a) $probe fails" || bad "(a) $probe exit=$rc (want 1)"
  grep -qF "$probe" <<<"$out" && pass "(a)   names $probe" || bad "(a)   did not name $probe"
  unstage "$probe"
done
rm -rf src/p1 src/p2 src/p3 src/p4 src/p5 src/p6 src/p7 2>/dev/null || true

# (a) exact-ONLY probe: fails, and is caught by the case-sensitive scan while
# invisible to the case-insensitive one. The pattern lists are read back out of
# the guard so the proof tracks the arrays it actually uses, not a copy.
stage "$EXACT_ONLY_PROBE"
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(a) exact-only $EXACT_ONLY_PROBE fails" || bad "(a) exact-only exit=$rc (want 1)"
grep -qF "$EXACT_ONLY_PROBE" <<<"$out" && pass "(a)   names it" || bad "(a)   did not name it"
arr() { awk "/^$1=\\(/{f=1;next} f&&/^\\)/{f=0} f{print}" "$G" | sed -e "s/^[[:space:]]*'//" -e "s/'[[:space:]]*\$//"; }
ep="$(mktemp)"; arr EXACT_PATTERNS    > "$ep"
wp="$(mktemp)"; arr WORKFLOW_PATTERNS > "$wp"
git ls-files | grep -E  -f "$ep" | grep -qF "$EXACT_ONLY_PROBE" \
  && pass "(a)   caught by EXACT_PATTERNS scan" || bad "(a)   NOT caught by EXACT_PATTERNS scan"
git ls-files | grep -iE -f "$wp" | grep -qF "$EXACT_ONLY_PROBE" \
  && bad "(a)   also matched WORKFLOW_PATTERNS (not exact-only)" || pass "(a)   invisible to WORKFLOW_PATTERNS scan"
rm -f "$ep" "$wp"
unstage "$EXACT_ONLY_PROBE"; rmdir agent 2>/dev/null || true

# (b) content regression, without echoing surrounding content
printf 'clone the private repo TRIPWIRE_SENTINEL_XYZ here\n' > src/_tripwire_probe.txt
git add src/_tripwire_probe.txt
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(b) 'private repo' fails" || bad "(b) exit=$rc (want 1)"
grep -q TRIPWIRE_SENTINEL_XYZ <<<"$out" && bad "(b) echoed surrounding content" || pass "(b) did not echo surrounding content"
grep -q 'pattern=' <<<"$out" && pass "(b) names the pattern" || bad "(b) did not name the pattern"
unstage src/_tripwire_probe.txt

total=$((pass_n + fail_n))
if (( fail_n )); then echo "tripwire-test: $fail_n/$total FAILED"; exit 1; fi
echo "tripwire-test: $total assertions, all passed"
exit 0
