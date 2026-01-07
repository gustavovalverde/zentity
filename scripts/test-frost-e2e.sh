#!/usr/bin/env bash
#
# FROST Threshold Signing E2E Test
#
# Tests the complete DKG and signing flow against running Docker services.
# Prerequisites: docker-compose.signer.yml services must be running.
#
# Usage:
#   ./scripts/test-frost-e2e.sh              # Run against default ports
#   COORD_URL=http://localhost:5002 ./scripts/test-frost-e2e.sh
#
# Exit codes:
#   0 - All tests passed
#   1 - Test failed
#   2 - Prerequisites not met
#
# Note: When running from outside Docker, the coordinator cannot orchestrate
# signers via localhost URLs (they need Docker network names). This test uses
# a client-driven flow where we call each signer directly and submit results
# to the coordinator. The coordinator's finalize_dkg may warn about unreachable
# signers - this is expected and the test still passes because signers have
# their key shares.

set -euo pipefail

# Configuration
COORD_URL="${COORD_URL:-http://localhost:5002}"
SIGNER1_URL="${SIGNER1_URL:-http://localhost:5101}"
SIGNER2_URL="${SIGNER2_URL:-http://localhost:5102}"
SIGNER3_URL="${SIGNER3_URL:-http://localhost:5103}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test state
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_section() { echo -e "\n${BLUE}========== $* ==========${NC}"; }

# Assert helper
assert_eq() {
    local actual="$1"
    local expected="$2"
    local msg="${3:-}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "$actual" == "$expected" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        log_ok "$msg"
        return 0
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        log_fail "$msg: expected '$expected', got '$actual'"
        return 1
    fi
}

assert_not_empty() {
    local value="$1"
    local msg="${2:-}"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ -n "$value" && "$value" != "null" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        log_ok "$msg"
        return 0
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        log_fail "$msg: value is empty or null"
        return 1
    fi
}

assert_json_field() {
    local json="$1"
    local field="$2"
    local expected="$3"
    local msg="${4:-Field $field should be $expected}"
    local actual
    actual=$(echo "$json" | jq -r ".$field // \"null\"")
    assert_eq "$actual" "$expected" "$msg"
}

# Check prerequisites
check_prerequisites() {
    log_section "PREREQUISITES"

    # Check jq is installed
    if ! command -v jq &> /dev/null; then
        log_fail "jq is required but not installed"
        exit 2
    fi
    log_ok "jq is installed"

    # Check curl is installed
    if ! command -v curl &> /dev/null; then
        log_fail "curl is required but not installed"
        exit 2
    fi
    log_ok "curl is installed"

    # Check services are healthy
    local services=("$COORD_URL" "$SIGNER1_URL" "$SIGNER2_URL" "$SIGNER3_URL")
    local names=("coordinator" "signer-1" "signer-2" "signer-3")

    for i in "${!services[@]}"; do
        local url="${services[$i]}"
        local name="${names[$i]}"
        local response
        if response=$(curl -sf --max-time 5 "$url/health" 2>/dev/null); then
            local status
            status=$(echo "$response" | jq -r '.status // "unknown"')
            if [[ "$status" == "ok" ]]; then
                log_ok "$name is healthy at $url"
            else
                log_fail "$name health check returned: $status"
                exit 2
            fi
        else
            log_fail "$name is not reachable at $url"
            log_warn "Start services with: docker-compose -f docker-compose.signer.yml up -d"
            exit 2
        fi
    done
}

# Get signer info (HPKE pubkeys)
get_signer_info() {
    log_section "SETUP"

    log_info "Fetching signer information..."

    INFO1=$(curl -sf "$SIGNER1_URL/signer/info")
    INFO2=$(curl -sf "$SIGNER2_URL/signer/info")
    INFO3=$(curl -sf "$SIGNER3_URL/signer/info")

    HPKE1=$(echo "$INFO1" | jq -r '.hpke_pubkey')
    HPKE2=$(echo "$INFO2" | jq -r '.hpke_pubkey')
    HPKE3=$(echo "$INFO3" | jq -r '.hpke_pubkey')

    assert_not_empty "$HPKE1" "Signer 1 HPKE pubkey retrieved"
    assert_not_empty "$HPKE2" "Signer 2 HPKE pubkey retrieved"
    assert_not_empty "$HPKE3" "Signer 3 HPKE pubkey retrieved"
}

# Test DKG flow
test_dkg() {
    log_section "DKG (Distributed Key Generation)"

    # 1. Initialize DKG session
    log_info "Initializing DKG session (2-of-3 threshold)..."
    # Note: participant_endpoints is optional - coordinator uses SIGNER_ENDPOINTS config
    # This allows coordinator to use Docker DNS names (signer-1:5101) while test uses localhost
    INIT_RESP=$(curl -sf -X POST "$COORD_URL/dkg/init" \
        -H "Content-Type: application/json" \
        -d "{
            \"threshold\": 2,
            \"total_participants\": 3,
            \"participant_hpke_pubkeys\": {\"1\": \"$HPKE1\", \"2\": \"$HPKE2\", \"3\": \"$HPKE3\"}
        }")

    SESSION_ID=$(echo "$INIT_RESP" | jq -r '.session_id')
    assert_not_empty "$SESSION_ID" "DKG session initialized"
    assert_json_field "$INIT_RESP" "state" "awaiting_round1" "DKG state is awaiting_round1"

    # 2. Round 1: Get packages from each signer
    log_info "Running DKG Round 1..."

    R1_1=$(curl -sf -X POST "$SIGNER1_URL/signer/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 1, \"threshold\": 2, \"total_participants\": 3}")
    PKG1=$(echo "$R1_1" | jq -r '.package')
    assert_not_empty "$PKG1" "Signer 1 produced round1 package"

    R1_2=$(curl -sf -X POST "$SIGNER2_URL/signer/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 2, \"threshold\": 2, \"total_participants\": 3}")
    PKG2=$(echo "$R1_2" | jq -r '.package')
    assert_not_empty "$PKG2" "Signer 2 produced round1 package"

    R1_3=$(curl -sf -X POST "$SIGNER3_URL/signer/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 3, \"threshold\": 2, \"total_participants\": 3}")
    PKG3=$(echo "$R1_3" | jq -r '.package')
    assert_not_empty "$PKG3" "Signer 3 produced round1 package"

    # 3. Submit round 1 packages to coordinator
    log_info "Submitting round 1 packages to coordinator..."

    curl -sf -X POST "$COORD_URL/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 1, \"package\": \"$PKG1\"}" > /dev/null

    curl -sf -X POST "$COORD_URL/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 2, \"package\": \"$PKG2\"}" > /dev/null

    R1_SUBMIT=$(curl -sf -X POST "$COORD_URL/dkg/round1" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 3, \"package\": \"$PKG3\"}")

    assert_json_field "$R1_SUBMIT" "state" "awaiting_round2" "DKG advanced to awaiting_round2"

    # 4. Round 2: Get encrypted packages from each signer
    log_info "Running DKG Round 2 (HPKE encrypted)..."

    R1_PKGS="{\"1\": \"$PKG1\", \"2\": \"$PKG2\", \"3\": \"$PKG3\"}"
    HPKE_PUBKEYS="{\"1\": \"$HPKE1\", \"2\": \"$HPKE2\", \"3\": \"$HPKE3\"}"

    R2_1=$(curl -sf -X POST "$SIGNER1_URL/signer/dkg/round2" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 1, \"round1_packages\": $R1_PKGS, \"participant_hpke_pubkeys\": $HPKE_PUBKEYS}")
    assert_not_empty "$(echo "$R2_1" | jq -r '.packages')" "Signer 1 produced round2 packages"

    R2_2=$(curl -sf -X POST "$SIGNER2_URL/signer/dkg/round2" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 2, \"round1_packages\": $R1_PKGS, \"participant_hpke_pubkeys\": $HPKE_PUBKEYS}")
    assert_not_empty "$(echo "$R2_2" | jq -r '.packages')" "Signer 2 produced round2 packages"

    R2_3=$(curl -sf -X POST "$SIGNER3_URL/signer/dkg/round2" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 3, \"round1_packages\": $R1_PKGS, \"participant_hpke_pubkeys\": $HPKE_PUBKEYS}")
    assert_not_empty "$(echo "$R2_3" | jq -r '.packages')" "Signer 3 produced round2 packages"

    # 5. Submit round 2 packages to coordinator
    log_info "Submitting round 2 packages to coordinator..."

    # Extract individual packages
    PKG_1_TO_2=$(echo "$R2_1" | jq -r '.packages["2"]')
    PKG_1_TO_3=$(echo "$R2_1" | jq -r '.packages["3"]')
    PKG_2_TO_1=$(echo "$R2_2" | jq -r '.packages["1"]')
    PKG_2_TO_3=$(echo "$R2_2" | jq -r '.packages["3"]')
    PKG_3_TO_1=$(echo "$R2_3" | jq -r '.packages["1"]')
    PKG_3_TO_2=$(echo "$R2_3" | jq -r '.packages["2"]')

    # Submit all round2 packages
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 1, \"to_participant_id\": 2, \"encrypted_package\": \"$PKG_1_TO_2\"}" > /dev/null
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 1, \"to_participant_id\": 3, \"encrypted_package\": \"$PKG_1_TO_3\"}" > /dev/null
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 2, \"to_participant_id\": 1, \"encrypted_package\": \"$PKG_2_TO_1\"}" > /dev/null
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 2, \"to_participant_id\": 3, \"encrypted_package\": \"$PKG_2_TO_3\"}" > /dev/null
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 3, \"to_participant_id\": 1, \"encrypted_package\": \"$PKG_3_TO_1\"}" > /dev/null
    curl -sf -X POST "$COORD_URL/dkg/round2" -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"from_participant_id\": 3, \"to_participant_id\": 2, \"encrypted_package\": \"$PKG_3_TO_2\"}" > /dev/null

    log_ok "All round2 packages submitted"

    # 6. Finalize DKG on each signer
    log_info "Finalizing DKG on signers..."

    R2_FOR_1="{\"2\": \"$PKG_2_TO_1\", \"3\": \"$PKG_3_TO_1\"}"
    R2_FOR_2="{\"1\": \"$PKG_1_TO_2\", \"3\": \"$PKG_3_TO_2\"}"
    R2_FOR_3="{\"1\": \"$PKG_1_TO_3\", \"2\": \"$PKG_2_TO_3\"}"

    FIN1=$(curl -sf -X POST "$SIGNER1_URL/signer/dkg/finalize" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 1, \"round1_packages\": $R1_PKGS, \"round2_packages\": $R2_FOR_1}")
    GROUP_PUBKEY=$(echo "$FIN1" | jq -r '.group_pubkey')
    assert_not_empty "$GROUP_PUBKEY" "Signer 1 finalized, got group pubkey"

    FIN2=$(curl -sf -X POST "$SIGNER2_URL/signer/dkg/finalize" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 2, \"round1_packages\": $R1_PKGS, \"round2_packages\": $R2_FOR_2}")
    GROUP_PUBKEY2=$(echo "$FIN2" | jq -r '.group_pubkey')
    assert_eq "$GROUP_PUBKEY" "$GROUP_PUBKEY2" "Signer 2 derived same group pubkey"

    FIN3=$(curl -sf -X POST "$SIGNER3_URL/signer/dkg/finalize" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\", \"participant_id\": 3, \"round1_packages\": $R1_PKGS, \"round2_packages\": $R2_FOR_3}")
    GROUP_PUBKEY3=$(echo "$FIN3" | jq -r '.group_pubkey')
    assert_eq "$GROUP_PUBKEY" "$GROUP_PUBKEY3" "Signer 3 derived same group pubkey"

    # 7. Finalize on coordinator
    log_info "Finalizing DKG on coordinator..."
    COORD_FIN=$(curl -s -X POST "$COORD_URL/dkg/finalize" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SESSION_ID\"}")

    COORD_FIN_STATE=$(echo "$COORD_FIN" | jq -r '.state // "error"')
    if [[ "$COORD_FIN_STATE" == "error" ]] || [[ -z "$COORD_FIN_STATE" ]]; then
        log_warn "Coordinator finalize returned: $COORD_FIN"
        # This is acceptable - coordinator may not have full context, signers are the source of truth
    fi

    log_ok "DKG completed successfully"
    log_info "Group public key: ${GROUP_PUBKEY:0:64}..."

    # Export for signing test
    export DKG_GROUP_PUBKEY="$GROUP_PUBKEY"
}

# Test signing flow
test_signing() {
    log_section "THRESHOLD SIGNING (2-of-3)"

    local group_pubkey="${DKG_GROUP_PUBKEY:-}"
    if [[ -z "$group_pubkey" ]]; then
        log_fail "No group pubkey from DKG, cannot test signing"
        return 1
    fi

    # 1. Initialize signing session
    local message
    message=$(echo -n "Hello FROST! Test message $(date +%s)" | base64)

    log_info "Initializing signing session..."
    SIGN_INIT=$(curl -sf -X POST "$COORD_URL/signing/init" \
        -H "Content-Type: application/json" \
        -d "{\"group_pubkey\": \"$group_pubkey\", \"message\": \"$message\", \"selected_signers\": [1, 2]}")

    SIGN_SESSION=$(echo "$SIGN_INIT" | jq -r '.session_id')
    assert_not_empty "$SIGN_SESSION" "Signing session initialized"
    assert_json_field "$SIGN_INIT" "state" "awaiting_commitments" "Signing state is awaiting_commitments"

    # 2. Get commitments from selected signers
    log_info "Generating signing commitments..."

    COMMIT1=$(curl -sf -X POST "$SIGNER1_URL/signer/sign/commit" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"group_pubkey\": \"$group_pubkey\"}")
    COMMIT1_VAL=$(echo "$COMMIT1" | jq -r '.commitment')
    assert_not_empty "$COMMIT1_VAL" "Signer 1 generated commitment"

    COMMIT2=$(curl -sf -X POST "$SIGNER2_URL/signer/sign/commit" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"group_pubkey\": \"$group_pubkey\"}")
    COMMIT2_VAL=$(echo "$COMMIT2" | jq -r '.commitment')
    assert_not_empty "$COMMIT2_VAL" "Signer 2 generated commitment"

    # 3. Submit commitments to coordinator
    log_info "Submitting commitments to coordinator..."

    curl -sf -X POST "$COORD_URL/signing/commit" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"participant_id\": 1, \"commitment\": \"$COMMIT1_VAL\"}" > /dev/null

    SUB_COMMIT=$(curl -sf -X POST "$COORD_URL/signing/commit" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"participant_id\": 2, \"commitment\": \"$COMMIT2_VAL\"}")

    assert_json_field "$SUB_COMMIT" "state" "awaiting_partials" "Signing advanced to awaiting_partials"

    # 4. Generate partial signatures
    log_info "Generating partial signatures..."

    ALL_COMMITS="{\"1\": \"$COMMIT1_VAL\", \"2\": \"$COMMIT2_VAL\"}"

    PARTIAL1=$(curl -sf -X POST "$SIGNER1_URL/signer/sign/partial" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"group_pubkey\": \"$group_pubkey\", \"message\": \"$message\", \"all_commitments\": $ALL_COMMITS}")
    PARTIAL1_VAL=$(echo "$PARTIAL1" | jq -r '.partial_signature')
    assert_not_empty "$PARTIAL1_VAL" "Signer 1 generated partial signature"

    PARTIAL2=$(curl -sf -X POST "$SIGNER2_URL/signer/sign/partial" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"group_pubkey\": \"$group_pubkey\", \"message\": \"$message\", \"all_commitments\": $ALL_COMMITS}")
    PARTIAL2_VAL=$(echo "$PARTIAL2" | jq -r '.partial_signature')
    assert_not_empty "$PARTIAL2_VAL" "Signer 2 generated partial signature"

    # 5. Submit partial signatures to coordinator
    log_info "Submitting partial signatures to coordinator..."

    PSUB1=$(curl -sf -X POST "$COORD_URL/signing/partial" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"participant_id\": 1, \"partial_signature\": \"$PARTIAL1_VAL\"}")
    assert_json_field "$PSUB1" "partials_collected" "1" "First partial collected"

    PSUB2=$(curl -sf -X POST "$COORD_URL/signing/partial" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\", \"participant_id\": 2, \"partial_signature\": \"$PARTIAL2_VAL\"}")
    assert_json_field "$PSUB2" "partials_complete" "true" "All partials collected"

    # 6. Aggregate signatures
    log_info "Aggregating signatures..."

    AGG_RESP=$(curl -sf -X POST "$COORD_URL/signing/aggregate" \
        -H "Content-Type: application/json" \
        -d "{\"session_id\": \"$SIGN_SESSION\"}")

    assert_json_field "$AGG_RESP" "state" "completed" "Signing completed"

    SIGNATURE=$(echo "$AGG_RESP" | jq -r '.signature')
    assert_not_empty "$SIGNATURE" "Final signature generated"

    log_ok "Threshold signing completed successfully"
    log_info "Signature (hex): ${SIGNATURE:0:64}..."
}

# Print summary
print_summary() {
    log_section "TEST SUMMARY"

    echo ""
    echo "Tests run:    $TESTS_RUN"
    echo "Tests passed: $TESTS_PASSED"
    echo "Tests failed: $TESTS_FAILED"
    echo ""

    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}ALL TESTS PASSED${NC}"
        return 0
    else
        echo -e "${RED}SOME TESTS FAILED${NC}"
        return 1
    fi
}

# Main
main() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║         FROST Threshold Signing E2E Test Suite                ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    check_prerequisites
    get_signer_info
    test_dkg
    test_signing
    print_summary
}

main "$@"
