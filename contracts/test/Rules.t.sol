// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VectorTest} from "./VectorTest.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Rules} from "../src/lib/Rules.sol";
import {TargetType, TierInput, TrustTier, Verdict} from "../src/interfaces/Types.sol";

/// Runs the Solidity rules against the same JSON vectors the TypeScript rules are tested with.
contract RulesTest is VectorTest {
    function test_weight_matchesVectors() public view {
        string memory json = _read("weight.json");
        uint256 n = _rows(json, "$");
        for (uint256 i; i < n; ++i) {
            int256 score = vm.parseJsonInt(json, _key("$", i, "score"));
            assertEq(Rules.weightOf(int32(score)), vm.parseJsonUint(json, _key("$", i, "weight")), vm.toString(score));
        }
    }

    function test_tier_matchesVectors() public view {
        string memory json = _read("tier.json");
        uint256 n = _rows(json, "$");
        for (uint256 i; i < n; ++i) {
            TierInput memory input = TierInput({
                confirmedDanger: vm.parseJsonBool(json, _key("$", i, "confirmedDanger")),
                codehashDrift: vm.parseJsonBool(json, _key("$", i, "codehashDrift")),
                activeDispute: vm.parseJsonBool(json, _key("$", i, "activeDispute")),
                safeWeight: uint32(vm.parseJsonUint(json, _key("$", i, "safeWeight"))),
                cautionWeight: uint32(vm.parseJsonUint(json, _key("$", i, "cautionWeight"))),
                dangerWeight: uint32(vm.parseJsonUint(json, _key("$", i, "dangerWeight"))),
                proxyMarker: vm.parseJsonBool(json, _key("$", i, "proxyMarker")),
                verifiedPublisherBond: vm.parseJsonBool(json, _key("$", i, "verifiedPublisherBond"))
            });
            assertEq(
                uint256(Rules.tierOf(input)),
                vm.parseJsonUint(json, _key("$", i, "tierIndex")),
                vm.parseJsonString(json, _key("$", i, "name"))
            );
        }
    }

    function test_xp_matchesVectors() public view {
        string memory json = _read("xp.json");
        uint256 n = _rows(json, "$");
        for (uint256 i; i < n; ++i) {
            int32 got = Rules.attestationXp(
                Verdict(vm.parseJsonUint(json, _key("$", i, "verdictIndex"))),
                uint32(vm.parseJsonUint(json, _key("$", i, "safeOrdinal"))),
                vm.parseJsonBool(json, _key("$", i, "eligible")),
                vm.parseJsonBool(json, _key("$", i, "confirmedDanger"))
            );
            assertEq(got, vm.parseJsonInt(json, _key("$", i, "xp")), vm.toString(i));
        }
    }

    function test_flags_matchVectors() public view {
        string memory json = _read("flags.json");
        uint256 n = _rows(json, "$");
        assertEq(n, 16);
        for (uint256 i; i < n; ++i) {
            assertEq(vm.parseJsonUint(json, _key("$", i, "bit")), i);
            TargetType t = i < 8 ? TargetType.SMART_CONTRACT : TargetType.AI_SKILL_BUNDLE;
            assertTrue(Rules.isValidFlags(t, Verdict.DANGER, uint32(1 << i)));
        }
    }

    function test_constants_matchVectors() public view {
        string memory json = _read("constants.json");
        assertEq(Constants.CHALLENGE_STAKE, vm.parseJsonUint(json, ".CHALLENGE_STAKE"));
        assertEq(Constants.JURY_STAKE, vm.parseJsonUint(json, ".JURY_STAKE"));
        assertEq(Constants.MAX_WARRANTY_BOND, vm.parseJsonUint(json, ".MAX_WARRANTY_BOND"));
        assertEq(Constants.MAX_BOUNTY, vm.parseJsonUint(json, ".MAX_BOUNTY"));
        assertEq(Constants.COMMIT_WINDOW, vm.parseJsonUint(json, ".COMMIT_WINDOW"));
        assertEq(Constants.REVEAL_WINDOW, vm.parseJsonUint(json, ".REVEAL_WINDOW"));
        assertEq(Constants.SETTLE_DELAY, vm.parseJsonUint(json, ".SETTLE_DELAY"));
        assertEq(Constants.BOND_UNBONDING, vm.parseJsonUint(json, ".BOND_UNBONDING"));
        assertEq(Constants.CHALLENGE_COOLDOWN, vm.parseJsonUint(json, ".CHALLENGE_COOLDOWN"));
        assertEq(Constants.EXPIRE_REPEAT_WINDOW, vm.parseJsonUint(json, ".EXPIRE_REPEAT_WINDOW"));
        assertEq(Constants.BOUNTY_TIMEOUT, vm.parseJsonUint(json, ".BOUNTY_TIMEOUT"));
        assertEq(Constants.DAILY_ATTEST_LIMIT, vm.parseJsonUint(json, ".DAILY_ATTEST_LIMIT"));
        assertEq(Constants.MIN_REVEALS, vm.parseJsonUint(json, ".MIN_REVEALS"));
        assertEq(Constants.MAX_JURORS, vm.parseJsonUint(json, ".MAX_JURORS"));
        assertEq(Constants.BOUNTY_MIN_SLOTS, vm.parseJsonUint(json, ".BOUNTY_MIN_SLOTS"));
        assertEq(Constants.BOUNTY_MAX_SLOTS, vm.parseJsonUint(json, ".BOUNTY_MAX_SLOTS"));
        assertEq(Constants.BOUNTY_FEE_BPS, vm.parseJsonUint(json, ".BOUNTY_FEE_BPS"));
        assertEq(Constants.BOND_SLASH_BPS, vm.parseJsonUint(json, ".BOND_SLASH_BPS"));
        assertEq(Constants.SHORT_PROOF_MAX_BYTES, vm.parseJsonUint(json, ".SHORT_PROOF_MAX_BYTES"));
        uint256[] memory forfeit = vm.parseJsonUintArray(json, ".EXPIRE_FORFEIT_BPS");
        assertEq(forfeit.length, 3);
        assertEq(Constants.expireForfeitBps(0), forfeit[0]);
        assertEq(Constants.expireForfeitBps(1), forfeit[1]);
        assertEq(Constants.expireForfeitBps(2), forfeit[2]);
        assertEq(Constants.expireForfeitBps(9), forfeit[2]);
    }

    function test_penalty_matchesVectors() public view {
        string memory json = _read("xp.json");
        uint256 n = _rows(json, "$");
        for (uint256 i; i < n; ++i) {
            int32 got = Rules.attestationPenalty(
                Verdict(vm.parseJsonUint(json, _key("$", i, "verdictIndex"))),
                vm.parseJsonBool(json, _key("$", i, "confirmedDanger"))
            );
            assertEq(got, vm.parseJsonInt(json, _key("$", i, "penalty")), vm.toString(i));
        }
    }

    function test_xpAmounts_matchVectors() public view {
        string memory json = _read("xpEvents.json");
        assertEq(Rules.XP_EARLY_SAFE, vm.parseJsonInt(json, ".EARLY_SAFE"));
        assertEq(Rules.XP_CONFIRMING_SAFE, vm.parseJsonInt(json, ".CONFIRMING_SAFE"));
        assertEq(Rules.XP_DANGER_CONFIRMED, vm.parseJsonInt(json, ".DANGER_CONFIRMED"));
        assertEq(Rules.XP_SAFE_ON_DANGER, vm.parseJsonInt(json, ".SAFE_ON_DANGER"));
        assertEq(Rules.XP_JUROR_MAJORITY, vm.parseJsonInt(json, ".JUROR_MAJORITY"));
        assertEq(Rules.XP_CHALLENGER_WON, vm.parseJsonInt(json, ".CHALLENGER_WON"));
        assertEq(Rules.XP_CHALLENGER_LOST, vm.parseJsonInt(json, ".CHALLENGER_LOST"));
    }

    function test_isValidFlags_matchesVectors() public view {
        string memory json = _read("flagValidity.json");
        uint256 n = _rows(json, "$");
        for (uint256 i; i < n; ++i) {
            uint256 flags = vm.parseJsonUint(json, _key("$", i, "flags"));
            // Values above uint32 cannot reach the contract at all: the ABI decoder rejects them.
            if (flags > type(uint32).max) continue;
            bool got = Rules.isValidFlags(
                TargetType(vm.parseJsonUint(json, _key("$", i, "targetTypeIndex"))),
                Verdict(vm.parseJsonUint(json, _key("$", i, "verdictIndex"))),
                uint32(flags)
            );
            assertEq(got, vm.parseJsonBool(json, _key("$", i, "valid")), vm.toString(i));
        }
    }

    function testFuzz_settleNeverChargesThePenalty(uint8 verdict, uint32 ordinal, bool eligible, bool danger)
        public
        pure
    {
        int32 xp = Rules.attestationXp(Verdict(verdict % 3), ordinal, eligible, danger);
        assertGe(xp, 0);
    }

    function test_isValidFlags_safeNeedsNoFlags() public pure {
        assertTrue(Rules.isValidFlags(TargetType.SMART_CONTRACT, Verdict.SAFE, 0));
        assertFalse(Rules.isValidFlags(TargetType.SMART_CONTRACT, Verdict.SAFE, 0x0002));
    }

    function test_isValidFlags_cautionAndDangerNeedAFlag() public pure {
        assertFalse(Rules.isValidFlags(TargetType.SMART_CONTRACT, Verdict.DANGER, 0));
        assertFalse(Rules.isValidFlags(TargetType.AI_SKILL_BUNDLE, Verdict.CAUTION, 0));
        assertTrue(Rules.isValidFlags(TargetType.AI_SKILL_BUNDLE, Verdict.CAUTION, 0x1000));
    }

    function test_isValidFlags_rejectsOtherTypeAndHighBits() public pure {
        assertFalse(Rules.isValidFlags(TargetType.SMART_CONTRACT, Verdict.DANGER, 0x8000));
        assertFalse(Rules.isValidFlags(TargetType.AI_SKILL_BUNDLE, Verdict.DANGER, 0x0002));
        assertFalse(Rules.isValidFlags(TargetType.AI_SKILL_BUNDLE, Verdict.DANGER, 0x18000));
    }

    function testFuzz_weight_neverAboveFive(int32 score) public pure {
        uint8 w = Rules.weightOf(score);
        assertLe(w, 5);
        if (score < 0) assertEq(w, 0);
        else assertGe(w, 1);
    }

    function testFuzz_tier_confirmedDangerAlwaysWins(TierInput memory i) public pure {
        i.confirmedDanger = true;
        assertEq(uint256(Rules.tierOf(i)), uint256(TrustTier.CONFIRMED_DANGER));
    }

    function testFuzz_tier_neverSafeWithProxyMarker(TierInput memory i) public pure {
        i.proxyMarker = true;
        TrustTier t = Rules.tierOf(i);
        assertTrue(t != TrustTier.COMMUNITY_SAFE && t != TrustTier.WARRANTY_BACKED_SAFE);
    }

    function testFuzz_tier_neverSafeWhileDisputedOrDrifted(TierInput memory i, bool drift) public pure {
        if (drift) i.codehashDrift = true;
        else i.activeDispute = true;
        TrustTier t = Rules.tierOf(i);
        assertTrue(t != TrustTier.COMMUNITY_SAFE && t != TrustTier.WARRANTY_BACKED_SAFE && t != TrustTier.UNRATED);
    }
}
