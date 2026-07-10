#!/usr/bin/env bash
#
# Self-test for the identity tripwire.
#   negative: legitimate lowercase content (src/content/skills.md, agent.md) must
#             PASS. These are the false positives the case-sensitive split fixes.
#   (a) path: an empty agent/scout.yml, and every workflow-name capitalization and
#             .yml/.yaml spelling, must FAIL. Ordinary machinery names stay
#             case-sensitive. An exact-ONLY probe proves the [exact] scan works on
#             its own, not just when a path also matches [workflow].
#   (b) content: "private repo" fails without echoing the surrounding content.
#   fail-closed: an empty denylist, an emptied [exact]/[workflow] section, and a
#             malformed section header are each exit 2.
#
# Exit: 0 all passed, 1 a test failed.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
G=".github/scripts/content-guard.sh"
fail=0
pass() { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }
# Each workflow-case probe gets its own directory. Scout.yml / SCOUT.yml /
# scout.YML share one basename, and a case-insensitive filesystem (NTFS, APFS)
# treats them as the same path, which corrupts the index if they are staged in
# one tree. Distinct directories keep them distinct paths everywhere.
WF_PROBES=(src/p1/Scout.yml src/p2/SCOUT.yml src/p3/scout.YML src/p4/scout.yaml \
  src/p5/Reviewer.yml src/p6/reviewer.yaml src/p7/nested/dir/Scout.YML)
NEG_PROBES=(src/content/skills.md src/content/agent.md)
# agent-ci-settings.json matches an [exact] pattern and CANNOT match [workflow]
# (no scout/reviewer basename), unlike agent/scout.yml which matches both. It is
# the probe the empty-[exact] gap needed.
EXACT_ONLY_PROBE=agent/agent-ci-settings.json
ALL_PROBES=(agent/scout.yml "$EXACT_ONLY_PROBE" src/_tripwire_probe.txt "${NEG_PROBES[@]}" "${WF_PROBES[@]}")
cleanup() {
  git reset -q HEAD "${ALL_PROBES[@]}" 2>/dev/null || true
  rm -f "${ALL_PROBES[@]}"
  rm -rf src/p1 src/p2 src/p3 src/p4 src/p5 src/p6 src/p7 src/content
  rmdir agent 2>/dev/null || true
  [[ -f /tmp/denylist.tt.bak ]] && { cp /tmp/denylist.tt.bak .github/scripts/denylist.txt; rm -f /tmp/denylist.tt.bak; }
  [[ -f /tmp/paths.tt.bak ]]    && { cp /tmp/paths.tt.bak    .github/scripts/forbidden-paths.txt; rm -f /tmp/paths.tt.bak; }
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

# (a) exact-ONLY probe: fails, and is caught by the [exact] scan while invisible
# to the [workflow] scan. Proving both is what makes an emptied [exact] section
# observable (agent/scout.yml hid it by also matching [workflow]).
stage "$EXACT_ONLY_PROBE"
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(a) exact-only $EXACT_ONLY_PROBE fails" || bad "(a) exact-only exit=$rc (want 1)"
grep -qF "$EXACT_ONLY_PROBE" <<<"$out" && pass "(a)   names it" || bad "(a)   did not name it"
sect() { awk -v s="[$1]" '$0==s{f=1;next} /^\[/{f=0} f && NF && $0 !~ /^[[:space:]]*#/{print}' .github/scripts/forbidden-paths.txt; }
ep="$(mktemp)"; sect exact    > "$ep"
wp="$(mktemp)"; sect workflow > "$wp"
git ls-files | grep -E  -f "$ep" | grep -qF "$EXACT_ONLY_PROBE" \
  && pass "(a)   caught by [exact] scan" || bad "(a)   NOT caught by [exact] scan"
git ls-files | grep -iE -f "$wp" | grep -qF "$EXACT_ONLY_PROBE" \
  && bad "(a)   also matched [workflow] (not exact-only)" || pass "(a)   invisible to [workflow] scan"
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

# fail closed: an empty denylist is a misconfiguration -> exit 2
cp .github/scripts/denylist.txt /tmp/denylist.tt.bak
printf '# only a comment\n' > .github/scripts/denylist.txt
bash "$G" >/dev/null 2>&1; rc=$?
cp /tmp/denylist.tt.bak .github/scripts/denylist.txt; rm -f /tmp/denylist.tt.bak
[[ $rc -eq 2 ]] && pass "empty denylist -> exit 2" || bad "empty denylist exit=$rc (want 2)"

# fail closed: parser misconfigurations. Both use an otherwise-valid file so the
# tested defect is the only cause of exit 2.
cp .github/scripts/forbidden-paths.txt /tmp/paths.tt.bak
# an emptied [exact] section (workflow still populated) is a broken guard
printf '[exact]\n[workflow]\n(^|/)scout\\.ya?ml$\n' > .github/scripts/forbidden-paths.txt
bash "$G" >/dev/null 2>&1; rc=$?
[[ $rc -eq 2 ]] && pass "empty [exact] -> exit 2" || bad "empty [exact] exit=$rc (want 2)"
# a malformed [workflo] header must be rejected, not swallowed as a pattern
printf '[exact]\n^agent/\n[workflow]\n(^|/)scout\\.ya?ml$\n[workflo]\n(^|/)reviewer\\.ya?ml$\n' > .github/scripts/forbidden-paths.txt
bash "$G" >/dev/null 2>&1; rc=$?
cp /tmp/paths.tt.bak .github/scripts/forbidden-paths.txt; rm -f /tmp/paths.tt.bak
[[ $rc -eq 2 ]] && pass "malformed [workflo] header -> exit 2" || bad "malformed header exit=$rc (want 2)"

(( fail )) && { echo "tripwire-test: FAILURES"; exit 1; }
echo "tripwire-test: all passed"
exit 0
