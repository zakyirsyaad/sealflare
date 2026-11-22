// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployLocal} from "../script/DeployLocal.s.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {ICourt} from "../src/interfaces/ICourt.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {
    ChallengeOutcome,
    ChallengePhase,
    ChallengeView,
    GuardianView,
    JurorStatus,
    PublisherRole,
    BindMethod,
    TargetType,
    TargetView,
    TrustTier,
    Verdict
} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Ids} from "../src/lib/Ids.sol";
import {CoreStub} from "../src/stubs/CoreStub.sol";
import {CourtStub} from "../src/stubs/CourtStub.sol";
import {MockAgentID} from "../src/stubs/MockAgentID.sol";
import {VaultStub} from "../src/stubs/VaultStub.sol";

contract StubsTest is Test {
    MockAgentID internal agentId;
    CoreStub internal core;
    CourtStub internal court;
    VaultStub internal vault;

    address internal guardian = makeAddr("guardian");
    address internal target = makeAddr("target");
    bytes32 internal targetWord;
    bytes32 internal targetId;

    function setUp() public {
        DeployLocal deployer = new DeployLocal();
        (agentId, core, court, vault) = deployer.deploy();
        vm.etch(target, hex"6001");
        targetWord = bytes32(uint256(uint160(target)));
        targetId = Ids.targetIdOfContract(target);
    }

    function _attest(address from, Verdict verdict, uint32 flags) internal returns (bytes32) {
        vm.prank(from);
        return core.attest(TargetType.SMART_CONTRACT, targetWord, verdict, flags, keccak256("e"), "proof", "ipfs://x");
    }

    function test_deployLocal_wiresModules() public view {
        assertEq(core.agentId(), address(agentId));
        assertEq(core.court(), address(court));
        assertEq(core.vault(), address(vault));
        assertEq(court.core(), address(core));
        assertEq(court.vault(), address(vault));
        assertEq(vault.core(), address(core));
    }

    function test_mockAgentId_balanceIsSettable() public {
        assertEq(agentId.balanceOf(guardian), 0);
        agentId.setBalance(guardian, 1);
        assertEq(agentId.balanceOf(guardian), 1);
        assertTrue(core.isAgentIdHolder(guardian));
    }

    function test_attest_emitsFinalEventWithWeightAndOrdinals() public {
        vm.expectEmit(address(core));
        emit ICore.TargetCreated(targetId, TargetType.SMART_CONTRACT, targetWord, target.codehash);
        vm.expectEmit(address(core));
        emit ICore.GuardianCreated(guardian, uint64(block.number));
        vm.expectEmit(address(core));
        emit ICore.Attested(targetId, guardian, Verdict.SAFE, 0, 1, 0, 1, keccak256("e"), "proof", "ipfs://x");
        _attest(guardian, Verdict.SAFE, 0);
    }

    function test_attest_targetIdMatchesIdsLibrary() public {
        assertEq(_attest(guardian, Verdict.SAFE, 0), targetId);
        assertEq(core.targetIdOfContract(target), targetId);
    }

    function test_attest_usesTheWeightOfTheStubbedScore() public {
        GuardianView memory g;
        g.exists = true;
        g.score = 30;
        g.createdAtBlock = 1;
        core.stubSetGuardian(guardian, g);
        _attest(guardian, Verdict.SAFE, 0);
        assertEq(core.getAttestation(targetId, 0).weight, 3);
        assertEq(core.getTarget(targetId).safeWeight, 3);
        assertEq(uint256(core.tierOf(targetId)), uint256(TrustTier.COMMUNITY_SAFE));
    }

    function test_attest_secondVoteFromSameGuardianReverts() public {
        _attest(guardian, Verdict.SAFE, 0);
        vm.expectRevert(ICore.AlreadyAttested.selector);
        _attest(guardian, Verdict.SAFE, 0);
        (bool attested, uint32 index) = core.attestationIndexOf(targetId, guardian);
        assertTrue(attested);
        assertEq(index, 0);
    }

    function test_stubSetTier_isReturnedByTierOfAndVerifyContract() public {
        _attest(guardian, Verdict.SAFE, 0);
        core.stubSetTier(targetId, TrustTier.CONFIRMED_DANGER);
        assertEq(uint256(core.tierOf(targetId)), uint256(TrustTier.CONFIRMED_DANGER));
        (TrustTier tier,, bytes32 pinned,,) = core.verifyContract(target);
        assertEq(uint256(tier), uint256(TrustTier.CONFIRMED_DANGER));
        assertEq(pinned, target.codehash);
    }

    function test_stubSetTarget_isReturnedByGetTarget() public {
        TargetView memory v;
        v.targetType = TargetType.AI_SKILL_BUNDLE;
        v.safeWeight = 9;
        v.publisherRole = PublisherRole.VERIFIED_PUBLISHER;
        core.stubSetTarget(bytes32("t"), v);
        assertEq(core.getTarget(bytes32("t")).safeWeight, 9);
    }

    function test_stubSetAttestationsLeft_overridesTheDefault() public {
        assertEq(core.attestationsLeftToday(guardian), Constants.DAILY_ATTEST_LIMIT);
        core.stubSetAttestationsLeft(guardian, 0);
        assertEq(core.attestationsLeftToday(guardian), 0);
    }

    function test_bindSkill_usesCallerAsPublisher() public {
        bytes32 content = keccak256("bundle");
        bytes32 id = Ids.targetIdOfSkill(Ids.canonicalBundleHashOf(content, guardian));
        vm.expectEmit(address(core));
        emit ICore.PublisherBound(id, guardian, PublisherRole.VERIFIED_PUBLISHER, BindMethod.SKILL);
        vm.prank(guardian);
        assertEq(core.bindSkill(content), id);
    }

    function test_openChallenge_emitsWindowsTwelveHoursApart() public {
        _attest(guardian, Verdict.SAFE, 0);
        address challenger = makeAddr("challenger");
        vm.deal(challenger, 1 ether);
        uint64 commitEnds = uint64(block.timestamp) + 12 hours;
        vm.expectEmit(address(court));
        emit ICourt.ChallengeOpened(1, targetId, challenger, 2, keccak256("e"), "p", "ipfs://c", commitEnds, commitEnds + 12 hours);
        vm.prank(challenger);
        uint256 id = court.openChallenge{value: Constants.CHALLENGE_STAKE}(targetId, 2, keccak256("e"), "p", "ipfs://c");
        assertEq(id, 1);
        assertEq(uint256(court.phaseOf(id)), uint256(ChallengePhase.COMMIT));
        assertEq(vault.escrowOf(id), Constants.CHALLENGE_STAKE);
        assertEq(uint256(core.tierOf(targetId)), uint256(TrustTier.DISPUTED_CAUTION));
    }

    function test_phaseOf_followsTimeUnlessOverridden() public {
        _attest(guardian, Verdict.SAFE, 0);
        vm.deal(address(this), 1 ether);
        uint256 id = court.openChallenge{value: Constants.CHALLENGE_STAKE}(targetId, 2, bytes32(0), "", "");
        skip(12 hours);
        assertEq(uint256(court.phaseOf(id)), uint256(ChallengePhase.REVEAL));
        skip(12 hours);
        assertEq(uint256(court.phaseOf(id)), uint256(ChallengePhase.AWAITING_CLOSE));
        court.stubSetPhase(id, ChallengePhase.COMMIT);
        assertEq(uint256(court.phaseOf(id)), uint256(ChallengePhase.COMMIT));
    }

    function test_stubSetJurorStatus_isReturned() public {
        assertEq(uint256(court.jurorStatus(1, guardian)), uint256(JurorStatus.ELIGIBLE));
        court.stubSetJurorStatus(1, guardian, JurorStatus.HAS_ATTESTED);
        assertEq(uint256(court.jurorStatus(1, guardian)), uint256(JurorStatus.HAS_ATTESTED));
    }

    function test_stubSetChallenge_isReturned() public {
        ChallengeView memory c;
        c.targetId = targetId;
        c.reveals = 3;
        court.stubSetChallenge(7, c);
        assertEq(court.getChallenge(7).reveals, 3);
    }

    function test_vaultStub_creditThenWithdraw_paysOut() public {
        vm.deal(address(this), 1 ether);
        vault.stubCredit{value: 0.3 ether}(guardian);
        assertEq(vault.balanceOf(guardian), 0.3 ether);
        vm.expectEmit(address(vault));
        emit IVault.Withdrawn(guardian, 0.3 ether);
        vm.prank(guardian);
        vault.withdraw();
        assertEq(guardian.balance, 0.3 ether);
        assertEq(vault.balanceOf(guardian), 0);
    }

    function test_vaultStub_withdrawWithNoBalanceReverts() public {
        vm.expectRevert(IVault.NothingToWithdraw.selector);
        vm.prank(guardian);
        vault.withdraw();
    }

    function test_vaultStub_activeBondIsTheCurrentPublishersBondOnly() public {
        _attest(guardian, Verdict.SAFE, 0);
        address sponsor = makeAddr("sponsor");
        vm.deal(sponsor, 1 ether);
        vm.startPrank(sponsor);
        core.sponsor(targetId);
        vault.depositBond{value: 0.5 ether}(targetId);
        vm.stopPrank();
        assertEq(vault.bondOf(targetId, sponsor).amount, 0.5 ether);
        assertEq(vault.activeBond(targetId), 0.5 ether);

        // A verified publisher with no bond replaces the sponsor: the sponsor's bond no longer counts.
        core.bindByOwner(target, guardian, 0, "");
        assertEq(vault.activeBond(targetId), 0);
        assertEq(vault.bondOf(targetId, sponsor).amount, 0.5 ether);
    }

    function test_coreStub_dangerVoteIsPaidOnlyAfterTheDangerVerdict() public {
        _attest(guardian, Verdict.DANGER, 2);
        core.settle(targetId, 0, 1);
        assertFalse(core.getAttestation(targetId, 0).settled);
        assertEq(core.pendingSettlement(targetId), 0);

        core.applyVerdict(targetId, 1, ChallengeOutcome.UPHELD, 2);
        assertEq(core.pendingSettlement(targetId), 1);
        core.settle(targetId, 0, 1);
        assertEq(core.getGuardian(guardian).score, 5);
    }

    function test_coreStub_safeVoteOnDangerIsChargedOnce() public {
        _attest(guardian, Verdict.SAFE, 0);
        core.applyVerdict(targetId, 1, ChallengeOutcome.UPHELD, 2);
        core.settle(targetId, 0, 1);
        core.applyPenalties(targetId, 0, 1);
        core.applyPenalties(targetId, 0, 1);
        core.settle(targetId, 0, 1);
        assertEq(core.getGuardian(guardian).score, -15);
    }

    function test_coreStub_bindNonceRisesWithEachBinding() public {
        assertEq(core.bindNonce(target), 0);
        core.bindByOwner(target, guardian, 0, "");
        assertEq(core.bindNonce(target), 1);
    }

    function test_vaultStub_settleBond_namesTargetAndDepositor() public {
        _attest(guardian, Verdict.SAFE, 0);
        vm.deal(guardian, 1 ether);
        vm.startPrank(guardian);
        core.sponsor(targetId);
        vault.depositBond{value: 0.4 ether}(targetId);
        vm.stopPrank();
        vault.lockBond(9, targetId);
        vm.expectEmit(address(vault));
        emit IVault.BondSettled(9, targetId, guardian, 0.2 ether, 0.2 ether);
        vault.settleBond(9, 5000);
        assertEq(vault.bondOf(targetId, guardian).amount, 0.2 ether);
        assertEq(vault.escrowOf(9), 0.2 ether);
    }

    function test_stubs_refuseToDeployOffTheLocalChain() public {
        vm.chainId(56);
        vm.expectRevert();
        new MockAgentID();
        vm.expectRevert();
        new CoreStub(address(agentId));
        vm.expectRevert();
        new VaultStub(address(core), address(this));
        vm.expectRevert();
        new CourtStub(address(core), address(vault));
    }

    function test_courtStub_locksAndSlashesThePublishersBond() public {
        _attest(guardian, Verdict.SAFE, 0);
        vm.deal(guardian, 1 ether);
        vm.startPrank(guardian);
        core.sponsor(targetId);
        vault.depositBond{value: 0.4 ether}(targetId);
        vm.stopPrank();

        vm.deal(address(this), 1 ether);
        uint256 id = court.openChallenge{value: Constants.CHALLENGE_STAKE}(targetId, 2, bytes32(0), "", "");
        assertEq(vault.bondOf(targetId, guardian).lockedByChallengeId, id);

        address juror = makeAddr("juror");
        vm.deal(juror, 1 ether);
        vm.startPrank(juror);
        court.commitVote{value: Constants.JURY_STAKE}(id, bytes32(0));
        court.revealVote(id, true, bytes32(0));
        vm.stopPrank();
        court.resolve(id);
        assertEq(vault.bondOf(targetId, guardian).amount, 0.2 ether);
        assertEq(vault.bondOf(targetId, guardian).lockedByChallengeId, 0);
    }

    function test_vaultStub_everyCreditEmitsBalanceCredited() public {
        vm.deal(address(this), 1 ether);
        vm.expectEmit(address(vault));
        emit IVault.BalanceCredited(guardian, 0.1 ether);
        vault.stubCredit{value: 0.1 ether}(guardian);
    }

    function test_coreStub_marksVotesCastDuringADispute() public {
        _attest(guardian, Verdict.SAFE, 0);
        core.markDisputed(targetId, 1);
        address late = makeAddr("late");
        _attest(late, Verdict.SAFE, 0);
        assertFalse(core.getAttestation(targetId, 0).castDuringDispute);
        assertTrue(core.getAttestation(targetId, 1).castDuringDispute);
        core.applyVerdict(targetId, 1, ChallengeOutcome.REJECTED, 0);
        core.settle(targetId, 0, 2);
        assertEq(core.getGuardian(guardian).score, 2);
        assertEq(core.getGuardian(late).score, 0);
    }

    function test_vaultStub_rejectsPlainTransfers() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok);
    }
}
