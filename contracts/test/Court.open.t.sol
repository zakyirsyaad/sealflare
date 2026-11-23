// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICourt} from "../src/interfaces/ICourt.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {ChallengePhase, ChallengeView, TrustTier, Verdict} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Fixture} from "./helpers/Fixture.sol";

contract CourtOpenTest is Fixture {
    ICourt internal c;
    address internal target;
    bytes32 internal id;
    address internal challenger;

    function setUp() public override {
        super.setUp();
        wireModules();
        c = ICourt(court);
        target = deployTarget();
        id = attestAs(holder("attester"), target, Verdict.SAFE, 0);
        challenger = holder("challenger");
    }

    function openRaw(address who, bytes32 targetId, uint32 flags, bytes memory proof, uint256 value)
        internal
        returns (uint256)
    {
        vm.prank(who);
        return c.openChallenge{value: value}(targetId, flags, keccak256("challenge"), proof, "ipfs://challenge");
    }

    function expectOpenReverts(bytes32 targetId, uint32 flags, bytes memory proof, uint256 value, bytes memory err)
        internal
    {
        vm.prank(challenger);
        vm.expectRevert(err);
        c.openChallenge{value: value}(targetId, flags, keccak256("challenge"), proof, "ipfs://challenge");
    }

    /// A skill whose verified publisher is `pub`, with a SAFE vote so it can be challenged.
    function publishedSkill(address pub) internal returns (bytes32 skillId) {
        vm.prank(pub);
        skillId = core.bindSkill(keccak256("bundle"));
    }

    // ---- openChallenge -------------------------------------------------------------------------

    function test_open_validChallenge_escrowsStakeAndMarksDispute() public {
        uint64 commitEnds = uint64(block.timestamp) + Constants.COMMIT_WINDOW;
        uint64 revealEnds = commitEnds + Constants.REVEAL_WINDOW;
        vm.expectEmit(court);
        emit ICourt.ChallengeOpened(
            1, id, challenger, 0x01, keccak256("challenge"), "proof", "ipfs://challenge", commitEnds, revealEnds
        );
        uint256 challengeId = openChallengeAs(challenger, id);

        assertEq(challengeId, 1);
        assertEq(IVault(vault).escrowOf(1), Constants.CHALLENGE_STAKE);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.DISPUTED_CAUTION));
        assertEq(core.getTarget(id).activeChallengeId, 1);
        assertEq(c.activeChallengeOf(id), 1);
        assertEq(court.balance, 0);
        ChallengeView memory v = c.getChallenge(1);
        assertEq(v.targetId, id);
        assertEq(v.challenger, challenger);
        assertEq(v.openedAtBlock, block.number);
        assertEq(v.commitEndsAt, commitEnds);
        assertEq(v.revealEndsAt, revealEnds);
    }

    function test_open_wrongStake_reverts() public {
        bytes memory err = abi.encodeWithSelector(ICourt.WrongStake.selector, Constants.CHALLENGE_STAKE);
        vm.deal(challenger, 1 ether);
        expectOpenReverts(id, 0x01, "proof", 0, err);
        expectOpenReverts(id, 0x01, "proof", 0.009 ether, err);
        expectOpenReverts(id, 0x01, "proof", 0.011 ether, err);
    }

    function test_open_notHolder_reverts() public {
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(ICourt.NotAgentIdHolder.selector);
        c.openChallenge{value: Constants.CHALLENGE_STAKE}(id, 0x01, bytes32(0), "", "");
    }

    function test_open_unknownTarget_reverts() public {
        expectOpenReverts(
            keccak256("unknown"),
            0x01,
            "proof",
            Constants.CHALLENGE_STAKE,
            abi.encodeWithSelector(ICourt.TargetNotFound.selector)
        );
    }

    function test_open_secondWhileActive_reverts() public {
        openChallengeAs(challenger, id);
        address other = holder("other");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(ICourt.ChallengeAlreadyActive.selector, 1));
        c.openChallenge{value: Constants.CHALLENGE_STAKE}(id, 0x01, bytes32(0), "", "");
    }

    function test_open_onConfirmedDanger_reverts() public {
        confirmDanger(id, 99, 0x01);
        expectOpenReverts(
            id,
            0x01,
            "proof",
            Constants.CHALLENGE_STAKE,
            abi.encodeWithSelector(ICourt.TargetAlreadyConfirmedDanger.selector)
        );
    }

    function test_open_withoutFlagsOrWrongTypeFlags_reverts() public {
        bytes memory err = abi.encodeWithSelector(ICourt.InvalidFlags.selector);
        expectOpenReverts(id, 0, "proof", Constants.CHALLENGE_STAKE, err);
        expectOpenReverts(id, 0x0100, "proof", Constants.CHALLENGE_STAKE, err);
    }

    function test_open_shortProofTooLong_reverts() public {
        bytes memory proof = new bytes(Constants.SHORT_PROOF_MAX_BYTES + 1);
        expectOpenReverts(
            id, 0x01, proof, Constants.CHALLENGE_STAKE, abi.encodeWithSelector(ICourt.ShortProofTooLong.selector)
        );
    }

    function test_open_locksPublishersBond() public {
        address pub = holder("publisher");
        bytes32 skillId = publishedSkill(pub);
        vm.prank(pub);
        IVault(vault).depositBond{value: 0.2 ether}(skillId);
        uint256 challengeId = openChallengeAs(challenger, skillId);
        assertEq(IVault(vault).bondOf(skillId, pub).lockedByChallengeId, challengeId);
    }

    function test_open_challengerWithoutProfile_isAllowed() public {
        assertFalse(core.getGuardian(challenger).exists);
        assertEq(openChallengeAs(challenger, id), 1);
    }

    // ---- counter evidence ----------------------------------------------------------------------

    function test_counterEvidence_byVerifiedPublisherInCommit_isStored() public {
        address pub = holder("publisher");
        bytes32 skillId = publishedSkill(pub);
        uint256 challengeId = openChallengeAs(challenger, skillId);
        vm.expectEmit(court);
        emit ICourt.CounterEvidenceSubmitted(challengeId, pub, "ipfs://counter");
        vm.prank(pub);
        c.submitCounterEvidence(challengeId, "ipfs://counter");
        assertEq(c.getChallenge(challengeId).counterEvidenceURI, "ipfs://counter");
    }

    function test_counterEvidence_bySponsorOrStranger_reverts() public {
        address s = holder("sponsor");
        vm.prank(s);
        core.sponsor(id);
        uint256 challengeId = openChallengeAs(challenger, id);
        vm.prank(s);
        vm.expectRevert(ICourt.NotPublisher.selector);
        c.submitCounterEvidence(challengeId, "ipfs://counter");
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ICourt.NotPublisher.selector);
        c.submitCounterEvidence(challengeId, "ipfs://counter");
    }

    function test_counterEvidence_afterCommitPhase_reverts() public {
        address pub = holder("publisher");
        bytes32 skillId = publishedSkill(pub);
        uint256 challengeId = openChallengeAs(challenger, skillId);
        toCommitPhaseEnd(challengeId);
        vm.prank(pub);
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.REVEAL));
        c.submitCounterEvidence(challengeId, "ipfs://counter");
    }

    function test_counterEvidence_unknownChallenge_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ICourt.WrongPhase.selector, ChallengePhase.NONE));
        c.submitCounterEvidence(7, "ipfs://counter");
    }

    // ---- phaseOf -------------------------------------------------------------------------------

    function test_phaseOf_followsTheClock() public {
        assertEq(uint8(c.phaseOf(1)), uint8(ChallengePhase.NONE));
        uint256 challengeId = openChallengeAs(challenger, id);
        ChallengeView memory v = c.getChallenge(challengeId);
        assertEq(uint8(c.phaseOf(challengeId)), uint8(ChallengePhase.COMMIT));
        vm.warp(v.commitEndsAt - 1);
        assertEq(uint8(c.phaseOf(challengeId)), uint8(ChallengePhase.COMMIT));
        vm.warp(v.commitEndsAt);
        assertEq(uint8(c.phaseOf(challengeId)), uint8(ChallengePhase.REVEAL));
        vm.warp(v.revealEndsAt - 1);
        assertEq(uint8(c.phaseOf(challengeId)), uint8(ChallengePhase.REVEAL));
        vm.warp(v.revealEndsAt);
        assertEq(uint8(c.phaseOf(challengeId)), uint8(ChallengePhase.AWAITING_CLOSE));
    }

    function test_nextExpireForfeitBps_startsAtTwentyPercent() public view {
        assertEq(c.nextExpireForfeitBps(id), 2000);
        assertEq(c.cooldownEndsAt(challenger, id), 0);
    }
}
