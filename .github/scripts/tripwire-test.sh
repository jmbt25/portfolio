#!/usr/bin/env bash
#
# Self-test for the identity tripwire, both directions:
#   (a) reintroduce an EMPTY agent/scout.yml and assert the PATH scan fails.
#   (b) add "private repo" to a tracked file and assert the CONTENT scan fails,
#       without echoing the surrounding content.
# Plus a fail-closed check: an empty denylist is exit 2, not a pass.
#
# Exit: 0 all passed, 1 a test failed.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
G=".github/scripts/content-guard.sh"
fail=0
pass() { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; fail=1; }
cleanup() {
  git reset -q HEAD agent/scout.yml src/_tripwire_probe.txt src/Reviewer.yml src/reviewer.yaml src/nested/dir/Scout.YML 2>/dev/null || true
  rm -f agent/scout.yml src/_tripwire_probe.txt src/Reviewer.yml src/reviewer.yaml
  rm -rf src/nested; rmdir agent 2>/dev/null || true
  [[ -f /tmp/denylist.tt.bak ]] && { cp /tmp/denylist.tt.bak .github/scripts/denylist.txt; rm -f /tmp/denylist.tt.bak; }
}
trap cleanup EXIT

# clean tree passes
bash "$G" >/dev/null 2>&1 && pass "clean tree passes" || bad "clean tree should pass"

# (a) filename regression: an EMPTY agent/scout.yml must fail on the PATH
mkdir -p agent; : > agent/scout.yml; git add agent/scout.yml
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(a) empty agent/scout.yml fails" || bad "(a) filename regression exit=$rc (want 1)"
grep -q 'agent/scout.yml' <<<"$out" && pass "(a) names the offending path" || bad "(a) did not name the path"
git reset -q HEAD agent/scout.yml; rm -f agent/scout.yml; rmdir agent 2>/dev/null || true

# (a) case and extension variants must also fail the PATH scan, and via the
# FILENAME patterns (not the agent/ shortcut): a case-different Reviewer.yml, the
# .yaml spelling, and a nested case-variant.
for probe in "src/Reviewer.yml" "src/reviewer.yaml" "src/nested/dir/Scout.YML"; do
  mkdir -p "$(dirname "$probe")"; : > "$probe"; git add "$probe"
  out="$(bash "$G" 2>&1)"; rc=$?
  [[ $rc -eq 1 ]] && pass "(a) $probe fails" || bad "(a) $probe exit=$rc (want 1)"
  grep -qF "$probe" <<<"$out" && pass "(a)   names $probe" || bad "(a)   did not name $probe"
  git reset -q HEAD "$probe"; rm -f "$probe"
done
rm -rf src/nested 2>/dev/null || true

# (b) content regression: 'private repo' in a tracked file must fail, without
# echoing the surrounding content (the sentinel).
printf 'clone the private repo TRIPWIRE_SENTINEL_XYZ here\n' > src/_tripwire_probe.txt
git add src/_tripwire_probe.txt
out="$(bash "$G" 2>&1)"; rc=$?
[[ $rc -eq 1 ]] && pass "(b) 'private repo' fails" || bad "(b) content regression exit=$rc (want 1)"
grep -q TRIPWIRE_SENTINEL_XYZ <<<"$out" && bad "(b) echoed surrounding content" || pass "(b) did not echo surrounding content"
grep -q 'pattern=' <<<"$out" && pass "(b) names the pattern" || bad "(b) did not name the pattern"
git reset -q HEAD src/_tripwire_probe.txt; rm -f src/_tripwire_probe.txt

# fail closed: an empty denylist is a misconfiguration -> exit 2
cp .github/scripts/denylist.txt /tmp/denylist.tt.bak
printf '# only a comment\n' > .github/scripts/denylist.txt
bash "$G" >/dev/null 2>&1; rc=$?
cp /tmp/denylist.tt.bak .github/scripts/denylist.txt; rm -f /tmp/denylist.tt.bak
[[ $rc -eq 2 ]] && pass "empty denylist -> exit 2" || bad "empty denylist exit=$rc (want 2)"

(( fail )) && { echo "tripwire-test: FAILURES"; exit 1; }
echo "tripwire-test: all passed"
exit 0
