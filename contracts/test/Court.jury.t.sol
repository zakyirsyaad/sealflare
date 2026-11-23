// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ICourt} from "../src/interfaces/ICourt.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {ChallengePhase, ChallengeView, JurorStatus, JurorView, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";

contract CourtJuryTest is Fixture {
    ICourt internal c;
    address internal target;
    bytes32 internal id;
    address internal challenger;
    address internal attester;
    address internal sponsorJ;
    address internal j30;
    address internal j0;
    uint256 internal challengeId;

    bytes32 internal constant SALT = keccak256("salt");

    function setUp() public override {
        super.setUp();
        wireModules();
        c = ICourt(court);
        target = deployTarget();
        attester = holder("attester");
        id = attestAs(attester, target, Verdict.SAFE, 0);
        sponsorJ = juror("sponsor", 0);
        vm.prank(sponsorJ);
        core.sponsor(id);
        challenger = juror("challenger", 0);
        j30 = juror("j30", 30);
        j0 = juror("j0", 0);
        vm.roll(block.number + 1);
        challengeId = openChallengeAs(challenger, id);
    }

    function expectCommitReverts(address who, uint256 cid, uint256 value, bytes memory err) internal {
        bytes32 hash = c.commitHashOf(cid, who, true, SALT);
        vm.deal(who, who.balance + value);
        vm.prank(who);
        vm.expectRevert(err);
        c.commitVote{value: value}(cid, hash);
    }

    function expectIneligible(address who, JurorStatus status) internal {
        assertEq(uint8(c.jurorStatus(challengeId, who)), uint8(status));
        expectCommitReverts(
            who, challengeId, Constants.JURY_STAKE, abi.encodeWithSelector(ICourt.NotEligibleJuror.selector, status)
        );
    }

    // ---- commit --------------------------------------------------------------------------------

    function test_commit_eligibleJuror_escrowsStakeAndFreezesWeight() public {
        assertEq(uint8(c.jurorStatus(challengeId, j30)), uint8(JurorStatus.ELIGIBLE));
        vm.expectEmit(court);
        emit ICourt.VoteCommitted(challengeId, j30, 3);
        commitAs(j30, challengeId, true, SALT);
        assertEq(IVault(vault).escrowOf(challengeId), Constants.CHALLENGE_STAKE + Constants.JURY_STAKE);
        JurorView memory v = c.getJuror(challengeId, j30);
        assertTrue(v.committed);
        assertEq(v.weight, 3);
        assertEq(c.getChallenge(challengeId).commits, 1);
        assertEq(court.balance, 0);
    }

    function test_commit_wrongStake_reverts() public {
        bytes memory err = abi.encodeWithSelector(ICourt.WrongStake.selector, Constants.JURY_STAKE);
        expectCommitReverts(j30, challengeId, 0.004 ether, err);
        expectCommitReverts(j30, challengeId, 0, err);
    }

    function test_commit_eachIneligibleStatus_reverts() public {
        address noLonger = juror("no-longer-holder", 0);
        address fresh = holder("fresh");
        address negative = j30;
        setScore(negative, -1);
        agentId.setBalance(noLonger, 0);
        commitAs(j0, challengeId, true, SALT);

        expectIneligible(noLonger, JurorStatus.NOT_AGENT_ID_HOLDER);
        expectIneligible(j0, JurorStatus.ALREADY_COMMITTED);
        expectIneligible(challenger, JurorStatus.IS_CHALLENGER);
        expectIneligible(sponsorJ, JurorStatus.IS_PUBLISHER);
        expectIneligible(attester, JurorStatus.HAS_ATTESTED);
        expectIneligible(fresh, JurorStatus.PROFILE_TOO_NEW);
        expectIneligible(negative, JurorStatus.NEGATIVE_SCORE);
    }

    function test_commit_profileCreatedInSameBlockAsChallenge_isTooNew() public {
        address late = juror("late", 10);
        assertEq(core.getGuardian(late).createdAtBlock, c.getChallenge(challengeId).openedAtBlock);
        expectIneligible(late, JurorStatus.PROFILE_TOO_NEW);
    }

    function test_commit_twentySecondJuror_reverts() public {
        address[] memory pool = new address[](Constants.MAX_JURORS + 1);
        for (uint256 i = 0; i < pool.length; ++i) {
            pool[i] = juror(string.concat("pool-", vm.toString(i)), 0);
        }
        address second = deployTarget();
        bytes32 secondId = attestAs(holder("second-attester"), second, Verdict.SAFE, 0);
        vm.roll(block.number + 1);
        uint256 cid = openChallengeAs(holder("second-challenger"), secondId);
        for (uint256 i = 0; i < Constants.MAX_JURORS; ++i) {
            commitAs(pool[i], cid, true, SALT);
        }
        address last = pool[Constants.MAX_JURORS];
        assertEq(uint8(c.jurorStatus(cid, last)), uint8(JurorStatus.JURY_FULL));
        expectCommitReverts(
            last,
            cid,
            Constants.JURY_STAKE,
            abi.encodeWithSelector(ICourt.NotEligibleJuror.selector, JurorStatus.JURY_FULL)
        );
    }

    function test_commit_afterCommitPhase_reverts() public {
        toCommitPhaseEnd(challengeId);
        expectIneligible(j30, JurorStatus.NOT_IN_COMMIT_PHASE);
    }

    function test_commit_unknownChallenge_isNotInCommitPhase() public view {
        assertEq(uint8(c.jurorStatus(99, j30)), uint8(JurorStatus.NOT_IN_COMMIT_PHASE));
    }

    function test_commit_doesNotRevealDirection() public {
        vm.recordLogs();
        commitAs(j30, challengeId, true, SALT);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != court) continue;
            assertEq(logs[i].topics[0], ICourt.VoteCommitted.selector);
            assertEq(abi.decode(logs[i].data, (uint8)), 3);
            assertEq(logs[i].data.length, 32);
            found = true;
        }
        assertTrue(found);
        JurorView memory v = c.getJuror(challengeId, j30);
        assertFalse(v.uphold);
        assertFalse(v.revealed);
        assertEq(v.commitHash, c.commitHashOf(challengeId, j30, true, SALT));
    }

    // ---- reveal --------------------------------------------------------------------------------

    function test_reveal_matchingCommit_countsWeight() public {
        commitAs(j30, challengeId, true, SALT);
        toCommitPhaseEnd(challengeId);
        vm.expectEmit(court);
        emit ICourt.VoteRevealed(challengeId, j30, true, 3);
        revealAs(j30, challengeId, true, SALT);
        ChallengeView memory v = c.getChallenge(challengeId);
        assertEq(v.upholdWeight, 3);
        assertEq(v.rejectWeight, 0);
        assertEq(v.reveals, 1);
        assertTrue(c.getJuror(challengeId, j30).uphold);
    }

    function test_reveal_rejectVote_countsRejectWeight() public {
        commitAs(j0, challengeId, false, SALT);
        toCommitPhaseEnd(challengeId);
        revealAs(j0, challengeId, false, SALT);
        assertEq(c.getChallenge(challengeId).rejectWeight, 1);
    }

    function test_reveal_wrongSaltOrDirection_reverts() public {
        commitAs(j30, challengeId, true, SALT);
        toCommitPhaseEnd(challengeId);
        vm.startPrank(j30);
        vm.expectRevert(ICourt.CommitMismatch.selector);
        c.revealVote(challengeId, true, keccak256("other"));
        vm.expectRevert(ICourt.CommitMismatch.selector);
        c.revealVote(challengeId, false, SALT);
        vm.stopPrank();
    }

    function test_reveal_withoutCommit_reverts() public {
        toCommitPhaseEnd(challengeId);
        vm.prank(j30);
        vm.expectRevert(ICourt.CommitMismatch.selector);
        c.revealVote(challengeId, true, SALT);
    }

    function test_reveal_copiedCommitFromAnotherJuror_reverts() public {
        commitAs(j30, challengeId, true, SALT);
        bytes32 copied = c.getJuror(challengeId, j30).commitHash;
        vm.deal(j0, Constants.JURY_STAKE);
        vm.prank(j0);
        c.commitVote{value: Constants.JURY_STAKE}(challengeId, copied);
        toCommitPhaseEnd(challengeId);
        vm.prank(j0);
        vm.expectRevert(ICourt.CommitMismatch.selector);
        c.revealVote(challengeId, true, SALT);
    }

    function test_reveal_twice_reverts() public {
        commitAs(j30, challengeId, true, SALT);
        toCommitPhaseEnd(challengeId);
        revealAs(j30, challengeId, true, SALT);
        vm.prank(j30);
        vm.expectRevert(ICourt.AlreadyRevealed.selector);
        c.revealVote(challengeId, true, SALT);
    }

    function test_reveal_duringCommitOrAfterReveal_reverts() public {
        commitAs(j30, challengeId, true, SALT);
        vm.prank(j30);
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.COMMIT));
        c.revealVote(challengeId, true, SALT);
        toRevealPhaseEnd(challengeId);
        vm.prank(j30);
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.AWAITING_CLOSE));
        c.revealVote(challengeId, true, SALT);
    }

    function test_reveal_weightChangedSinceCommit_usesFrozenWeight() public {
        commitAs(j30, challengeId, true, SALT);
        setScore(j30, 0);
        assertEq(core.weightOf(j30), 1);
        toCommitPhaseEnd(challengeId);
        vm.expectEmit(court);
        emit ICourt.VoteRevealed(challengeId, j30, true, 3);
        revealAs(j30, challengeId, true, SALT);
        assertEq(c.getChallenge(challengeId).upholdWeight, 3);
    }

    function test_commitHashOf_isKeccakOfIdJurorUpholdSalt() public view {
        assertEq(c.commitHashOf(7, j30, true, SALT), keccak256(abi.encode(uint256(7), j30, true, SALT)));
        assertTrue(c.commitHashOf(7, j30, true, SALT) != c.commitHashOf(7, j0, true, SALT));
    }
}
