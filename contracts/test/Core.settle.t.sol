// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {ChallengeOutcome, ScoreReason, TrustTier, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";
import {FakeCourt, FakeVault} from "./helpers/Mocks.sol";

contract CoreSettleTest is Fixture {
    address internal target;
    bytes32 internal id;

    function setUp() public override {
        super.setUp();
        target = deployTarget();
        id = core.targetIdOfContract(target);
    }

    function voter(uint256 i) internal returns (address who) {
        who = address(uint160(2000 + i));
        agentId.setBalance(who, 1);
    }

    function voteAs(uint256 i, Verdict v) internal returns (address who) {
        who = voter(i);
        attestAs(who, target, v, v == Verdict.SAFE ? 0 : 0x01);
    }

    function safeVotes(uint256 count) internal {
        for (uint256 i = 0; i < count; ++i) {
            voteAs(i, Verdict.SAFE);
        }
    }

    function scoreOf(address who) internal view returns (int32) {
        return core.getGuardian(who).score;
    }

    function afterSettleDelay() internal {
        vm.warp(block.timestamp + Constants.SETTLE_DELAY);
    }

    function assertTwelveSafeScores() internal view {
        int32[12] memory expected = [int32(2), 2, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0];
        for (uint256 i = 0; i < 12; ++i) {
            assertEq(scoreOf(address(uint160(2000 + i))), expected[i]);
        }
    }

    // ---- setModules -----------------------------------------------------------------------------

    function test_setModules_byDeployer_setsBothAndEmits() public {
        address v = address(new FakeVault(address(core)));
        address c = address(new FakeCourt(address(core), v));
        vm.expectEmit(address(core));
        emit ICore.ModulesSet(c, v);
        core.setModules(c, v);
        assertEq(core.court(), c);
        assertEq(core.vault(), v);
    }

    function test_setModules_byOther_reverts() public {
        address v = address(new FakeVault(address(core)));
        address c = address(new FakeCourt(address(core), v));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ICore.OnlyDeployer.selector);
        core.setModules(c, v);
    }

    function test_setModules_twice_reverts() public {
        wireModules();
        vm.expectRevert(ICore.ModulesAlreadySet.selector);
        core.setModules(court, vault);
    }

    function test_setModules_courtPointsAtOtherCore_reverts() public {
        address v = address(new FakeVault(address(core)));
        address c = address(new FakeCourt(address(0xBEEF), v));
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(c, v);
    }

    function test_setModules_vaultPointsAtOtherCore_reverts() public {
        address v = address(new FakeVault(address(0xBEEF)));
        address c = address(new FakeCourt(address(core), v));
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(c, v);
    }

    function test_setModules_courtPointsAtOtherVault_reverts() public {
        address v = address(new FakeVault(address(core)));
        address other = address(new FakeVault(address(core)));
        address c = address(new FakeCourt(address(core), other));
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(c, v);
    }

    function test_setModules_zeroAddress_reverts() public {
        address v = address(new FakeVault(address(core)));
        address c = address(new FakeCourt(address(core), v));
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(address(0), v);
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(c, address(0));
        assertEq(core.court(), address(0));
    }

    // ---- Court-only access ---------------------------------------------------------------------

    function expectCourtOnlyReverts(address sender) internal {
        vm.startPrank(sender);
        vm.expectRevert(ICore.OnlyCourt.selector);
        core.markDisputed(id, 1);
        vm.expectRevert(ICore.OnlyCourt.selector);
        core.applyVerdict(id, 1, ChallengeOutcome.UPHELD, 0x01);
        vm.expectRevert(ICore.OnlyCourt.selector);
        core.adjustScore(sender, id, 5, ScoreReason.CHALLENGER_WON);
        vm.stopPrank();
    }

    function test_courtOnly_beforeSetModules_alwaysRevert() public {
        voteAs(0, Verdict.SAFE);
        expectCourtOnlyReverts(address(this));
        expectCourtOnlyReverts(address(0));
    }

    function test_courtOnly_fromNonCourt_revert() public {
        wireModules();
        voteAs(0, Verdict.SAFE);
        expectCourtOnlyReverts(makeAddr("stranger"));
        expectCourtOnlyReverts(vault);
    }

    // ---- settle --------------------------------------------------------------------------------

    function test_settle_before48h_paysNothing() public {
        address g = voteAs(0, Verdict.SAFE);
        vm.warp(block.timestamp + Constants.SETTLE_DELAY - 1);
        core.settle(id, 0, 10);
        assertEq(scoreOf(g), 0);
        assertFalse(core.getAttestation(id, 0).settled);
    }

    function test_settle_after48h_paysTwoForFirstThree_oneForNextSeven_zeroAfter() public {
        safeVotes(12);
        afterSettleDelay();
        core.settle(id, 0, 12);
        assertTwelveSafeScores();
        assertTrue(core.getAttestation(id, 11).settled);
    }

    function test_settle_twice_paysOnce() public {
        address g = voteAs(0, Verdict.SAFE);
        afterSettleDelay();
        core.settle(id, 0, 1);
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 2);
    }

    function test_settle_pagesAreIndependent() public {
        safeVotes(12);
        afterSettleDelay();
        core.settle(id, 0, 5);
        core.settle(id, 5, 7);
        assertTwelveSafeScores();
    }

    function test_settle_rangeBeyondEnd_isClamped() public {
        address first = voteAs(0, Verdict.SAFE);
        address second = voteAs(1, Verdict.SAFE);
        afterSettleDelay();
        core.settle(id, 1, type(uint32).max);
        core.settle(id, 50, 10);
        assertEq(scoreOf(first), 0);
        assertEq(scoreOf(second), 2);
    }

    function test_settle_duringDispute_paysNothing_thenPaysAfterRejection() public {
        wireModules();
        address g = voteAs(0, Verdict.SAFE);
        vm.prank(court);
        core.markDisputed(id, 1);
        afterSettleDelay();
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 0);

        vm.prank(court);
        core.applyVerdict(id, 1, ChallengeOutcome.REJECTED, 0);
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 2);
    }

    function test_settle_voteCastDuringDispute_settlesWithZero() public {
        wireModules();
        voteAs(0, Verdict.CAUTION);
        vm.prank(court);
        core.markDisputed(id, 1);
        address g = voteAs(1, Verdict.SAFE);
        assertTrue(core.getAttestation(id, 1).castDuringDispute);
        vm.prank(court);
        core.applyVerdict(id, 1, ChallengeOutcome.REJECTED, 0);
        afterSettleDelay();

        vm.recordLogs();
        core.settle(id, 1, 1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], ICore.AttestationSettled.selector);
        (uint32 index, int32 delta) = abi.decode(logs[0].data, (uint32, int32));
        assertEq(index, 1);
        assertEq(delta, 0);
        assertTrue(core.getAttestation(id, 1).settled);
        assertEq(scoreOf(g), 0);
    }

    function test_settle_dangerVote_paidOnlyAfterUpheldVerdict() public {
        wireModules();
        address g = voteAs(0, Verdict.DANGER);
        afterSettleDelay();
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 0);
        assertFalse(core.getAttestation(id, 0).settled);

        confirmDanger(id, 1, 0x01);
        vm.expectEmit(address(core));
        emit ICore.AttestationSettled(id, 0, 5);
        vm.expectEmit(address(core));
        emit ICore.ScoreChanged(g, id, 5, 5, ScoreReason.DANGER_CONFIRMED);
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 5);
    }

    function test_settle_safeVoteOnConfirmedDanger_isSkipped() public {
        wireModules();
        address g = voteAs(0, Verdict.SAFE);
        confirmDanger(id, 1, 0x01);
        afterSettleDelay();
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 0);
        assertFalse(core.getAttestation(id, 0).settled);
    }

    // ---- applyPenalties ------------------------------------------------------------------------

    function test_applyPenalties_chargesFifteenOnce() public {
        wireModules();
        address g = voteAs(0, Verdict.SAFE);
        confirmDanger(id, 1, 0x01);
        vm.expectEmit(address(core));
        emit ICore.ScoreChanged(g, id, -15, -15, ScoreReason.SAFE_ON_DANGER);
        core.applyPenalties(id, 0, 10);
        core.applyPenalties(id, 0, 10);
        assertEq(scoreOf(g), -15);
        assertTrue(core.getAttestation(id, 0).penalized);
    }

    function test_applyPenalties_withoutDangerVerdict_reverts() public {
        voteAs(0, Verdict.SAFE);
        vm.expectRevert(ICore.NothingToSettle.selector);
        core.applyPenalties(id, 0, 10);
    }

    function test_applyPenalties_afterEarlierXp_netIsMinusThirteen() public {
        address g = voteAs(0, Verdict.SAFE);
        afterSettleDelay();
        core.settle(id, 0, 1);
        assertEq(scoreOf(g), 2);
        wireModules();
        confirmDanger(id, 1, 0x01);
        core.applyPenalties(id, 0, 1);
        assertEq(scoreOf(g), -13);
    }

    function test_pendingSettlement_and_pendingPenalties_countWhatACallWouldChange() public {
        wireModules();
        safeVotes(3);
        voteAs(3, Verdict.DANGER);
        voteAs(4, Verdict.CAUTION);
        assertEq(core.pendingSettlement(id), 0);
        assertEq(core.pendingPenalties(id), 0);

        afterSettleDelay();
        assertEq(core.pendingSettlement(id), 3);
        core.settle(id, 0, 1);
        assertEq(core.pendingSettlement(id), 2);

        confirmDanger(id, 1, 0x01);
        assertEq(core.pendingSettlement(id), 1);
        assertEq(core.pendingPenalties(id), 3);
        core.applyPenalties(id, 0, 2);
        assertEq(core.pendingPenalties(id), 1);
        core.settle(id, 0, 5);
        assertEq(core.pendingSettlement(id), 0);
    }

    // ---- Court-only writes ---------------------------------------------------------------------

    function test_markDisputed_setsActiveChallenge_tierIsDisputedCaution() public {
        wireModules();
        safeVotes(3);
        vm.expectEmit(address(core));
        emit ICore.DisputeMarked(id, 7);
        vm.prank(court);
        core.markDisputed(id, 7);
        assertEq(core.getTarget(id).activeChallengeId, 7);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.DISPUTED_CAUTION));
    }

    function test_applyVerdict_upheld_setsConfirmedDangerAndFlags() public {
        wireModules();
        voteAs(0, Verdict.DANGER);
        vm.startPrank(court);
        core.markDisputed(id, 3);
        vm.expectEmit(address(core));
        emit ICore.VerdictApplied(id, 3, ChallengeOutcome.UPHELD, 0x02);
        core.applyVerdict(id, 3, ChallengeOutcome.UPHELD, 0x02);
        vm.stopPrank();
        assertTrue(core.getTarget(id).confirmedDanger);
        assertEq(core.getTarget(id).activeFlags, 0x03);
        assertEq(core.getTarget(id).activeChallengeId, 0);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.CONFIRMED_DANGER));
    }

    function test_applyVerdict_rejected_clearsDisputeOnly() public {
        wireModules();
        safeVotes(3);
        vm.startPrank(court);
        core.markDisputed(id, 3);
        core.applyVerdict(id, 3, ChallengeOutcome.REJECTED, 0x02);
        vm.stopPrank();
        assertFalse(core.getTarget(id).confirmedDanger);
        assertEq(core.getTarget(id).activeFlags, 0);
        assertEq(core.getTarget(id).activeChallengeId, 0);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
    }

    function test_applyVerdict_wrongChallengeId_reverts() public {
        wireModules();
        voteAs(0, Verdict.SAFE);
        vm.startPrank(court);
        vm.expectRevert(ICore.NothingToSettle.selector);
        core.applyVerdict(id, 3, ChallengeOutcome.UPHELD, 0x01);
        core.markDisputed(id, 3);
        vm.expectRevert(ICore.NothingToSettle.selector);
        core.applyVerdict(id, 4, ChallengeOutcome.UPHELD, 0x01);
        vm.stopPrank();
        assertFalse(core.getTarget(id).confirmedDanger);
    }

    function test_markDisputed_unknownTarget_reverts() public {
        wireModules();
        vm.prank(court);
        vm.expectRevert(ICore.TargetNotFound.selector);
        core.markDisputed(id, 1);
    }

    function test_adjustScore_createsProfileForNewAccount() public {
        wireModules();
        address juror = makeAddr("juror");
        vm.expectEmit(address(core));
        emit ICore.GuardianCreated(juror, uint64(block.number));
        vm.expectEmit(address(core));
        emit ICore.ScoreChanged(juror, id, 3, 3, ScoreReason.JUROR_MAJORITY);
        vm.prank(court);
        core.adjustScore(juror, id, 3, ScoreReason.JUROR_MAJORITY);
        assertTrue(core.getGuardian(juror).exists);
        assertEq(scoreOf(juror), 3);
    }

    function test_adjustScore_negativeScore_weightIsZero() public {
        wireModules();
        address challenger = makeAddr("challenger");
        vm.prank(court);
        core.adjustScore(challenger, id, -5, ScoreReason.CHALLENGER_LOST);
        assertEq(scoreOf(challenger), -5);
        assertEq(core.weightOf(challenger), 0);
    }

    // ---- no temporary bodies left -------------------------------------------------------------

    function test_core_noRevertStubLeft() public view {
        string[3] memory files = ["src/Core.sol", "src/CoreBase.sol", "src/CoreSettlement.sol"];
        for (uint256 i = 0; i < files.length; ++i) {
            string memory source = vm.readFile(files[i]);
            assertEq(vm.indexOf(source, "not implemented"), type(uint256).max, files[i]);
        }
    }

    // ---- review fixes --------------------------------------------------------------------------

    function test_setModules_sameAddressForBoth_reverts() public {
        address both = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        FakeCourt c = new FakeCourt(address(core), both);
        assertEq(address(c), both);
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.setModules(both, both);
    }

    function test_markDisputed_whileAnotherIsActive_reverts() public {
        wireModules();
        voteAs(0, Verdict.SAFE);
        vm.startPrank(court);
        core.markDisputed(id, 1);
        vm.expectRevert(ICore.ModuleMismatch.selector);
        core.markDisputed(id, 2);
        vm.stopPrank();
        assertEq(core.getTarget(id).activeChallengeId, 1);
    }

    function test_settle_dangerVoteAfterVerdict_settlesWithZero() public {
        wireModules();
        voteAs(0, Verdict.DANGER);
        confirmDanger(id, 1, 0x01);
        address late = voteAs(1, Verdict.DANGER);
        core.settle(id, 0, 2);
        assertEq(scoreOf(voter(0)), 5);
        assertEq(scoreOf(late), 0);
        assertTrue(core.getAttestation(id, 1).settled);
        assertEq(core.pendingSettlement(id), 0);
    }

    function test_settle_dangerVoteDuringDispute_settlesWithZero() public {
        wireModules();
        voteAs(0, Verdict.SAFE);
        vm.prank(court);
        core.markDisputed(id, 1);
        address mid = voteAs(1, Verdict.DANGER);
        assertTrue(core.getAttestation(id, 1).castDuringDispute);
        vm.prank(court);
        core.applyVerdict(id, 1, ChallengeOutcome.UPHELD, 0x01);
        vm.expectEmit(address(core));
        emit ICore.AttestationSettled(id, 1, 0);
        core.settle(id, 0, 2);
        assertEq(scoreOf(mid), 0);
    }
}
