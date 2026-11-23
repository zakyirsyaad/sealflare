// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {ICourt} from "../src/interfaces/ICourt.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {ChallengeOutcome, ChallengePhase, TrustTier, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";

contract CourtCloseTest is Fixture {
    ICourt internal c;
    IVault internal v;
    address internal attester;
    uint256 internal names;

    bytes32 internal constant SALT = keccak256("salt");
    uint256 internal constant C = Constants.CHALLENGE_STAKE;
    uint256 internal constant J = Constants.JURY_STAKE;

    function setUp() public override {
        super.setUp();
        wireModules();
        c = ICourt(court);
        v = IVault(vault);
        attester = holder("attester");
    }

    // ---- scenario helpers ----------------------------------------------------------------------

    /// A contract target with one SAFE vote from `attester`.
    function newTarget() internal returns (bytes32) {
        return attestAs(attester, deployTarget(), Verdict.SAFE, 0);
    }

    /// Jurors with the given scores, created a block before any challenge opened after this call.
    function jurors(int32[] memory scores) internal returns (address[] memory out) {
        out = new address[](scores.length);
        for (uint256 i = 0; i < scores.length; ++i) {
            out[i] = juror(string.concat("juror-", vm.toString(names++)), scores[i]);
        }
    }

    function zeros(uint256 n) internal pure returns (int32[] memory s) {
        s = new int32[](n);
    }

    /// Commits every juror, reveals those with `reveal[i]`, and moves past the reveal window.
    function vote(uint256 id, address[] memory js, bool[] memory uphold, bool[] memory reveal) internal {
        for (uint256 i = 0; i < js.length; ++i) {
            commitAs(js[i], id, uphold[i], SALT);
        }
        toCommitPhaseEnd(id);
        for (uint256 i = 0; i < js.length; ++i) {
            if (reveal[i]) revealAs(js[i], id, uphold[i], SALT);
        }
        toRevealPhaseEnd(id);
    }

    function bools(uint256 n, uint256 trueMask) internal pure returns (bool[] memory out) {
        out = new bool[](n);
        for (uint256 i = 0; i < n; ++i) {
            out[i] = (trueMask >> i) & 1 == 1;
        }
    }

    function all(uint256 n) internal pure returns (bool[] memory) {
        return bools(n, type(uint256).max);
    }

    function newChallenger() internal returns (address) {
        return holder(string.concat("challenger-", vm.toString(names++)));
    }

    /// Opens on `targetId` with jurors of `scores`, votes, and returns the challenge id.
    function runVote(
        bytes32 targetId,
        address challenger,
        int32[] memory scores,
        uint256 upholdMask,
        uint256 revealMask
    ) internal returns (uint256 id, address[] memory js) {
        js = jurors(scores);
        vm.roll(block.number + 1);
        id = openChallengeAs(challenger, targetId);
        vote(id, js, bools(scores.length, upholdMask), bools(scores.length, revealMask));
    }

    function expireWithNoVotes(bytes32 targetId, address challenger) internal returns (uint256 id) {
        id = openChallengeAs(challenger, targetId);
        toRevealPhaseEnd(id);
        c.expire(id);
    }

    // ---- phase and quorum ----------------------------------------------------------------------

    function test_resolve_beforeRevealEnds_reverts() public {
        bytes32 t = newTarget();
        uint256 id = openChallengeAs(newChallenger(), t);
        toCommitPhaseEnd(id);
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.REVEAL));
        c.resolve(id);
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.REVEAL));
        c.expire(id);
    }

    function test_resolve_unknownChallenge_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.NONE));
        c.resolve(9);
    }

    function test_resolve_withTwoReveals_reverts() public {
        (uint256 id,) = runVote(newTarget(), newChallenger(), zeros(3), 7, 3);
        vm.expectRevert(ICourt.QuorumNotReached.selector);
        c.resolve(id);
    }

    function test_expire_withThreeReveals_reverts() public {
        (uint256 id,) = runVote(newTarget(), newChallenger(), zeros(3), 7, 7);
        vm.expectRevert(ICourt.QuorumReached.selector);
        c.expire(id);
    }

    function test_resolve_or_expire_twice_reverts() public {
        (uint256 id,) = runVote(newTarget(), newChallenger(), zeros(3), 7, 7);
        c.resolve(id);
        vm.expectRevert(ICourt.ChallengeClosed.selector);
        c.resolve(id);
        vm.expectRevert(ICourt.ChallengeClosed.selector);
        c.expire(id);
        uint256 id2 = expireWithNoVotes(newTarget(), newChallenger());
        vm.expectRevert(ICourt.ChallengeClosed.selector);
        c.expire(id2);
    }

    // ---- resolve -------------------------------------------------------------------------------

    function test_resolve_upheld_noBond_threeToZero() public {
        bytes32 t = newTarget();
        address ch = juror("challenger", 0);
        (uint256 id, address[] memory js) = runVote(t, ch, zeros(3), 7, 7);
        vm.expectEmit(court);
        emit ICourt.ChallengeResolved(id, ChallengeOutcome.UPHELD, 3, 0);
        c.resolve(id);

        assertEq(v.escrowOf(id), 0);
        assertEq(v.balanceOf(ch), C);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(v.balanceOf(js[i]), J);
            assertEq(core.getGuardian(js[i]).score, 3);
        }
        assertEq(v.balanceOf(treasury), 0);
        assertEq(core.getGuardian(ch).score, 5);
        assertEq(uint8(core.tierOf(t)), uint8(TrustTier.CONFIRMED_DANGER));
        assertEq(uint8(c.getChallenge(id).outcome), uint8(ChallengeOutcome.UPHELD));
        assertEq(uint8(c.phaseOf(id)), uint8(ChallengePhase.CLOSED));
        assertEq(c.activeChallengeOf(t), 0);
    }

    function test_resolve_upheld_withMinorityAndBond() public {
        address pub = holder("publisher");
        vm.prank(pub);
        bytes32 skillId = core.bindSkill(keccak256("bundle"));
        vm.prank(pub);
        v.depositBond{value: 0.4 ether}(skillId);
        address ch = newChallenger();
        // jurors 0..2 uphold, 3 rejects, 4 commits and never reveals
        (uint256 id, address[] memory js) = runVote(skillId, ch, zeros(5), 0x07, 0x0f);
        c.resolve(id);

        assertEq(v.balanceOf(ch), C + 0.105 ether);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(v.balanceOf(js[i]), J + 0.035 ether);
        }
        assertEq(v.balanceOf(js[3]), 0);
        assertEq(v.balanceOf(js[4]), 0);
        assertEq(v.balanceOf(treasury), 0);
        assertEq(v.escrowOf(id), 0);
        assertEq(v.bondOf(skillId, pub).amount, 0.2 ether);
        assertEq(v.bondOf(skillId, pub).lockedByChallengeId, 0);
    }

    function test_resolve_rejected_challengerStakeGoesToMajority() public {
        bytes32 t = newTarget();
        TrustTier before = core.tierOf(t);
        address ch = juror("challenger", 0);
        (uint256 id, address[] memory js) = runVote(t, ch, zeros(3), 0, 7);
        c.resolve(id);

        for (uint256 i = 0; i < 3; ++i) {
            assertEq(v.balanceOf(js[i]), J + 0.003333333333333333 ether);
            assertEq(core.getGuardian(js[i]).score, 3);
        }
        assertEq(v.balanceOf(treasury), 1);
        assertEq(v.balanceOf(ch), 0);
        assertEq(core.getGuardian(ch).score, -5);
        assertEq(uint8(core.tierOf(t)), uint8(before));
        assertEq(v.escrowOf(id), 0);
    }

    function test_resolve_weightBeatsHeadcount() public {
        int32[] memory scores = new int32[](4);
        scores[0] = 100;
        (uint256 id,) = runVote(newTarget(), newChallenger(), scores, 0x01, 0x0f);
        vm.expectEmit(court);
        emit ICourt.ChallengeResolved(id, ChallengeOutcome.UPHELD, 5, 3);
        c.resolve(id);
    }

    function test_resolve_tied_returnsStakes_unrevealedToTreasury() public {
        int32[] memory scores = new int32[](4);
        scores[0] = 10; // weight 2 upholds; jurors 1 and 2 reject with weight 1; juror 3 never reveals
        address ch = newChallenger();
        (uint256 id, address[] memory js) = runVote(newTarget(), ch, scores, 0x01, 0x07);
        vm.recordLogs();
        c.resolve(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != ICore.ScoreChanged.selector);
        }
        assertEq(uint8(c.getChallenge(id).outcome), uint8(ChallengeOutcome.TIED));
        assertEq(v.balanceOf(ch), C);
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(v.balanceOf(js[i]), J);
        }
        assertEq(v.balanceOf(js[3]), 0);
        assertEq(v.balanceOf(treasury), J);
        assertEq(v.escrowOf(id), 0);
    }

    function test_resolve_distributesExactlyTheEscrow() public {
        uint256[4] memory upholdMasks = [uint256(0x07), 0x00, 0x01, 0x07];
        uint256[4] memory revealMasks = [uint256(0x0f), 0x0f, 0x07, 0x03];
        int32[] memory scores = zeros(4);
        scores[0] = 10;
        for (uint256 k = 0; k < 4; ++k) {
            (uint256 id,) = runVote(newTarget(), newChallenger(), scores, upholdMasks[k], revealMasks[k]);
            if (k == 3) c.expire(id);
            else c.resolve(id);
            assertEq(v.escrowOf(id), 0);
        }
    }

    function test_resolve_upheld_thenAttestersCanBePenalised() public {
        bytes32 t = newTarget();
        (uint256 id,) = runVote(t, newChallenger(), zeros(3), 7, 7);
        c.resolve(id);
        core.applyPenalties(t, 0, 10);
        assertEq(core.getGuardian(attester).score, -15);
    }

    function test_anyoneCanResolveOrExpire() public {
        (uint256 id,) = runVote(newTarget(), newChallenger(), zeros(3), 7, 7);
        vm.prank(makeAddr("anyone"));
        c.resolve(id);
        bytes32 t2 = newTarget();
        uint256 id2 = openChallengeAs(newChallenger(), t2);
        toRevealPhaseEnd(id2);
        vm.prank(makeAddr("anyone-else"));
        c.expire(id2);
        assertEq(uint8(c.getChallenge(id2).outcome), uint8(ChallengeOutcome.EXPIRED));
    }

    function test_resolve_gasWith21Jurors_isBelowFiveMillion() public {
        int32[] memory scores = zeros(Constants.MAX_JURORS);
        (uint256 id,) = runVote(newTarget(), newChallenger(), scores, 0x0fffff, 0x1fffff);
        uint256 before = gasleft();
        c.resolve(id);
        uint256 used = before - gasleft();
        assertLt(used, 5_000_000);
        assertEq(v.escrowOf(id), 0);
    }

    // ---- expire --------------------------------------------------------------------------------

    function test_expire_first_forfeitsTwentyPercent() public {
        address ch = newChallenger();
        // two jurors reveal, the third commits and never reveals
        (uint256 id, address[] memory js) = runVote(newTarget(), ch, zeros(3), 7, 3);
        vm.expectEmit(court);
        emit ICourt.ChallengeExpired(id, 2, 2000);
        c.expire(id);
        assertEq(v.balanceOf(ch), 0.008 ether);
        assertEq(v.balanceOf(js[0]), J);
        assertEq(v.balanceOf(js[1]), J);
        assertEq(v.balanceOf(js[2]), 0);
        assertEq(v.balanceOf(treasury), 0.002 ether + J);
        assertEq(v.escrowOf(id), 0);
    }

    function test_expire_secondWithin30Days_forfeitsFifty_thirdForfeitsAll() public {
        bytes32 t = newTarget();
        expireWithNoVotes(t, newChallenger());
        assertEq(c.nextExpireForfeitBps(t), 5000);
        address second = newChallenger();
        uint256 id2 = openChallengeAs(second, t);
        toRevealPhaseEnd(id2);
        vm.expectEmit(court);
        emit ICourt.ChallengeExpired(id2, 0, 5000);
        c.expire(id2);
        assertEq(v.balanceOf(second), C / 2);

        address third = newChallenger();
        uint256 id3 = openChallengeAs(third, t);
        toRevealPhaseEnd(id3);
        vm.expectEmit(court);
        emit ICourt.ChallengeExpired(id3, 0, 10_000);
        c.expire(id3);
        assertEq(v.balanceOf(third), 0);
        assertEq(v.escrowOf(id3), 0);
    }

    function test_expire_after30Days_ladderResets() public {
        bytes32 t = newTarget();
        expireWithNoVotes(t, newChallenger());
        vm.warp(block.timestamp + Constants.EXPIRE_REPEAT_WINDOW);
        assertEq(c.nextExpireForfeitBps(t), 2000);
        address ch = newChallenger();
        expireWithNoVotes(t, ch);
        assertEq(v.balanceOf(ch), 0.008 ether);
    }

    function test_expire_ladderCountsPerTargetNotPerChallenger() public {
        bytes32 a = newTarget();
        bytes32 b = newTarget();
        address same = newChallenger();
        expireWithNoVotes(a, same);
        assertEq(c.nextExpireForfeitBps(b), 2000);
        assertEq(c.nextExpireForfeitBps(a), 5000);
        address other = newChallenger();
        expireWithNoVotes(a, other);
        assertEq(v.balanceOf(other), C / 2);
    }

    function test_expire_setsSevenDayCooldownForThatChallengerAndTarget() public {
        bytes32 t = newTarget();
        bytes32 otherTarget = newTarget();
        address ch = newChallenger();
        expireWithNoVotes(t, ch);
        uint64 endsAt = uint64(block.timestamp) + Constants.CHALLENGE_COOLDOWN;
        assertEq(c.cooldownEndsAt(ch, t), endsAt);

        vm.deal(ch, 1 ether);
        vm.prank(ch);
        vm.expectRevert(abi.encodeWithSelector(ICourt.InCooldown.selector, endsAt));
        c.openChallenge{value: C}(t, 0x01, bytes32(0), "", "");

        openChallengeAs(ch, otherTarget);
        openChallengeAs(newChallenger(), t);
        vm.warp(endsAt);
        assertEq(c.cooldownEndsAt(ch, t), endsAt);
    }

    function test_expire_releasesBondUnslashed() public {
        address pub = holder("publisher");
        vm.prank(pub);
        bytes32 skillId = core.bindSkill(keccak256("bundle"));
        vm.prank(pub);
        v.depositBond{value: 0.4 ether}(skillId);
        expireWithNoVotes(skillId, newChallenger());
        assertEq(v.bondOf(skillId, pub).amount, 0.4 ether);
        assertEq(v.bondOf(skillId, pub).lockedByChallengeId, 0);
    }

    function test_expire_targetLeavesDisputedTier() public {
        bytes32 t = newTarget();
        TrustTier before = core.tierOf(t);
        uint256 id = openChallengeAs(newChallenger(), t);
        assertEq(uint8(core.tierOf(t)), uint8(TrustTier.DISPUTED_CAUTION));
        toRevealPhaseEnd(id);
        c.expire(id);
        assertEq(uint8(core.tierOf(t)), uint8(before));
        assertEq(core.getTarget(t).activeChallengeId, 0);
        assertEq(c.activeChallengeOf(t), 0);
    }

    // ---- fuzz ----------------------------------------------------------------------------------

    function testFuzz_close_neverLeavesOrOverdrawsEscrow(
        uint8 jurorCount,
        uint32 upholdMask,
        uint32 revealMask,
        uint96 bond
    ) public {
        uint256 n = bound(jurorCount, Constants.MIN_REVEALS, Constants.MAX_JURORS);
        bond = uint96(bound(bond, 0, Constants.MAX_WARRANTY_BOND));
        address pub = holder("publisher");
        vm.prank(pub);
        bytes32 skillId = core.bindSkill(keccak256("bundle"));
        if (bond > 0) {
            vm.prank(pub);
            v.depositBond{value: bond}(skillId);
        }
        address ch = newChallenger();
        (uint256 id, address[] memory js) = runVote(skillId, ch, zeros(n), upholdMask, revealMask);
        uint256 deposited = C + J * n;
        if (c.getChallenge(id).reveals >= Constants.MIN_REVEALS) c.resolve(id);
        else c.expire(id);

        uint256 slashed = bond - v.bondOf(skillId, pub).amount;
        uint256 credited = v.balanceOf(ch) + v.balanceOf(treasury);
        for (uint256 i = 0; i < n; ++i) {
            credited += v.balanceOf(js[i]);
        }
        assertEq(v.escrowOf(id), 0);
        assertEq(credited, deposited + slashed);
    }
}
