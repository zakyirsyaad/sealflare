// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Core} from "../src/Core.sol";
import {ICore} from "../src/interfaces/ICore.sol";
import {IVault} from "../src/interfaces/IVault.sol";
import {PublisherRole, TargetType, TrustTier, Verdict} from "../src/interfaces/Types.sol";
import {Fixture} from "./helpers/Fixture.sol";

// Test-only state setup for fields whose public writers arrive in Tasks 3 and 4.
contract TierCoreHarness is Core {
    constructor(address id) Core(id) {}

    function setPublisher(bytes32 id, PublisherRole role, address account, address vault_) external {
        _targets[id].publisherRole = role;
        _targets[id].publisher = account;
        vault = vault_;
    }

    function setDecision(bytes32 id, bool danger, uint256 dispute) external {
        _targets[id].confirmedDanger = danger;
        _targets[id].activeChallengeId = dispute;
    }
}

contract CoreTierTest is Fixture {
    address internal target;
    bytes32 internal id;

    function setUp() public override {
        super.setUp();
        target = deployTarget();
        id = core.targetIdOfContract(target);
    }

    function safeVotes(uint256 start, uint256 count) internal {
        for (uint256 i = start; i < start + count; ++i) {
            address who = address(uint160(1000 + i));
            agentId.setBalance(who, 1);
            attestAs(who, target, Verdict.SAFE, 0);
        }
    }

    function test_tierOf_unknownTarget_isUnrated() public view {
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.UNRATED));
    }

    function test_tierOf_threeSafe_isCommunitySafe() public {
        safeVotes(0, 3);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
    }

    function test_tierOf_codeChanged_isStaleDrift() public {
        safeVotes(0, 3);
        vm.etch(target, hex"00");
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.STALE_CODEHASH_DRIFT));
    }

    function test_tierOf_afterProbeOnProxy_isCautionFlagged() public {
        vm.etch(target, hex"6000f4");
        safeVotes(0, 3);
        core.probeBytecode(target);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.CAUTION_FLAGGED));
    }

    function test_tierOf_proxyFlagFromAttestationAlone_doesNotCloseSafe() public {
        safeVotes(0, 4);
        attestAs(holder("caution"), target, Verdict.CAUTION, 1 << 5);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
    }

    function test_probeBytecode_noDelegatecall_changesNothing() public {
        safeVotes(0, 3);
        bytes32 beforeState = keccak256(abi.encode(core.getTarget(id)));
        vm.recordLogs();
        core.probeBytecode(target);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(keccak256(abi.encode(core.getTarget(id))), beforeState);
    }

    function test_probeBytecode_isPermanentAndIdempotent() public {
        vm.etch(target, hex"f4");
        core.probeBytecode(target);
        vm.recordLogs();
        core.probeBytecode(target);
        assertEq(vm.getRecordedLogs().length, 0);
        vm.etch(target, hex"00");
        core.probeBytecode(target);
        assertTrue(core.getTarget(id).hasDelegatecall);
    }

    function test_probeBytecode_createsTargetRecord() public {
        vm.etch(target, hex"f4");
        vm.expectEmit(true, false, false, true, address(core));
        emit ICore.TargetCreated(id, TargetType.SMART_CONTRACT, word(target), target.codehash);
        vm.expectEmit(true, true, false, true, address(core));
        emit ICore.DelegatecallFlagged(id, address(this));
        core.probeBytecode(target);
        assertEq(core.getTarget(id).pinnedCodehash, target.codehash);
        assertTrue(core.getTarget(id).hasDelegatecall);
    }

    function test_probeBytecode_addressWithoutCode_reverts() public {
        vm.expectRevert(ICore.TargetHasNoCode.selector);
        core.probeBytecode(address(0x123));
    }

    function test_verifyContract_unknownTarget_returnsUnratedAndZeros() public view {
        (TrustTier tier, bool proxy, bytes32 pin, uint32 flags, uint256 bond) = core.verifyContract(target);
        assertEq(uint8(tier), 0);
        assertFalse(proxy);
        assertEq(pin, bytes32(0));
        assertEq(flags, 0);
        assertEq(bond, 0);
    }

    function test_verifyContract_proxy_reportsIsUpgradeableProxy() public {
        vm.etch(target, hex"f4");
        core.probeBytecode(target);
        (TrustTier tier, bool proxy, bytes32 pin,,) = core.verifyContract(target);
        assertTrue(proxy);
        assertEq(uint8(tier), uint8(TrustTier.CAUTION_FLAGGED));
        assertEq(pin, target.codehash);
    }

    function test_verifyContract_vaultUnset_bondIsZeroAndNoExternalCall() public {
        safeVotes(0, 3);
        vm.expectCall(address(0), abi.encodeWithSelector(IVault.activeBond.selector, id), uint64(0));
        (TrustTier tier,,,, uint256 bond) = core.verifyContract(target);
        assertEq(uint8(tier), uint8(TrustTier.COMMUNITY_SAFE));
        assertEq(bond, 0);
    }

    function test_verifySkillBundle_sponsorOnly_publisherIsZero() public {
        vm.skip(true); // Public sponsor binding arrives in Task 3.
    }

    function test_verifyContract_gasIsBounded() public {
        safeVotes(0, 3);
        uint256 few = measureVerify();
        safeVotes(3, 197);
        uint256 many = measureVerify();
        assertLe(many, few * 110 / 100);
    }

    function measureVerify() internal returns (uint256 used) {
        // Both readings start with cold Core storage, independently of attestation writes.
        vm.cool(address(core));
        uint256 start = gasleft();
        (TrustTier tier,,,,) = core.verifyContract(target);
        used = start - gasleft();
        assertEq(uint8(tier), uint8(TrustTier.COMMUNITY_SAFE));
    }

    function test_verifySkillBundle_unknown_returnsZeros() public view {
        (TrustTier tier, address publisher, uint32 flags, uint256 bond) = core.verifySkillBundle(bytes32(uint256(1)));
        assertEq(uint8(tier), 0);
        assertEq(publisher, address(0));
        assertEq(flags, 0);
        assertEq(bond, 0);
    }

    function test_tierOf_verifiedPublisher_requiresActiveBondAndVault() public {
        TierCoreHarness h = new TierCoreHarness(address(agentId));
        core = h;
        safeVotes(0, 3);
        address mockVault = makeAddr("vault");
        bytes memory callData = abi.encodeCall(IVault.activeBond, (id));
        vm.mockCall(mockVault, callData, abi.encode(0.4 ether));
        h.setPublisher(id, PublisherRole.THIRD_PARTY_SPONSOR, address(this), mockVault);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
        h.setPublisher(id, PublisherRole.VERIFIED_PUBLISHER, address(this), address(0));
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
        h.setPublisher(id, PublisherRole.VERIFIED_PUBLISHER, address(this), mockVault);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.WARRANTY_BACKED_SAFE));
        (,,,, uint256 bond) = core.verifyContract(target);
        assertEq(bond, 0.4 ether);
        vm.mockCall(mockVault, callData, abi.encode(uint256(0)));
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.COMMUNITY_SAFE));
    }

    function test_tierOf_dangerAndDriftPrecedeDispute() public {
        TierCoreHarness h = new TierCoreHarness(address(agentId));
        core = h;
        safeVotes(0, 3);
        h.setDecision(id, false, 1);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.DISPUTED_CAUTION));
        vm.etch(target, hex"00");
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.STALE_CODEHASH_DRIFT));
        h.setDecision(id, true, 1);
        assertEq(uint8(core.tierOf(id)), uint8(TrustTier.CONFIRMED_DANGER));
    }

    function test_verifySkillBundle_verifiedPublisherAndSponsor() public {
        TierCoreHarness h = new TierCoreHarness(address(agentId));
        core = h;
        bytes32 bundle = keccak256("bundle");
        bytes32 skillId = core.targetIdOfSkill(bundle);
        for (uint256 i; i < 3; ++i) {
            address who = holder(string(abi.encodePacked("skill", uint8(i))));
            vm.prank(who);
            core.attest(TargetType.AI_SKILL_BUNDLE, bundle, Verdict.SAFE, 0, bytes32(0), "", "");
        }
        address mockVault = makeAddr("vault");
        vm.mockCall(mockVault, abi.encodeCall(IVault.activeBond, (skillId)), abi.encode(1 ether));
        h.setPublisher(skillId, PublisherRole.THIRD_PARTY_SPONSOR, address(this), mockVault);
        (TrustTier tier, address publisher,, uint256 bond) = core.verifySkillBundle(bundle);
        assertEq(uint8(tier), uint8(TrustTier.COMMUNITY_SAFE));
        assertEq(publisher, address(0));
        assertEq(bond, 0);
        h.setPublisher(skillId, PublisherRole.VERIFIED_PUBLISHER, address(this), mockVault);
        (tier, publisher,, bond) = core.verifySkillBundle(bundle);
        assertEq(uint8(tier), uint8(TrustTier.WARRANTY_BACKED_SAFE));
        assertEq(publisher, address(this));
        assertEq(bond, 1 ether);
    }
}
