// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICore} from "../src/interfaces/ICore.sol";
import {
    AttestationView,
    ChallengeOutcome,
    GuardianView,
    TargetType,
    TargetView,
    Verdict
} from "../src/interfaces/Types.sol";
import {Constants} from "../src/lib/Constants.sol";
import {Ids} from "../src/lib/Ids.sol";
import {Fixture} from "./helpers/Fixture.sol";

contract CoreAttestTest is Fixture {
    function test_attest_firstVote_createsTargetAndGuardian() public {
        address g = holder("guardian");
        address t = deployTarget();
        bytes32 id = Ids.targetIdOfContract(t);
        bytes32 hash = keccak256("evidence");

        vm.expectEmit(address(core));
        emit ICore.TargetCreated(id, TargetType.SMART_CONTRACT, word(t), t.codehash);
        vm.expectEmit(address(core));
        emit ICore.GuardianCreated(g, uint64(block.number));
        vm.expectEmit(address(core));
        emit ICore.Attested(id, g, Verdict.SAFE, 0, 1, 0, 1, hash, "proof", "ipfs://evidence");

        assertEq(attestAs(g, t, Verdict.SAFE, 0), id);

        TargetView memory tv = core.getTarget(id);
        assertEq(uint256(tv.targetType), uint256(TargetType.SMART_CONTRACT));
        assertEq(tv.target, word(t));
        assertEq(tv.pinnedCodehash, t.codehash);
        assertEq(tv.safeWeight, 1);
        assertEq(tv.safeCount, 1);
        assertEq(tv.attestationCount, 1);
        assertEq(tv.createdAt, uint64(block.timestamp));
        assertFalse(tv.confirmedDanger);
        assertEq(tv.activeChallengeId, 0);

        GuardianView memory gv = core.getGuardian(g);
        assertTrue(gv.exists);
        assertEq(gv.score, 0);
        assertEq(gv.createdAtBlock, uint64(block.number));
        assertEq(gv.attestationCount, 1);
        assertEq(gv.attestsToday, 1);

        AttestationView memory av = core.getAttestation(id, 0);
        assertEq(av.guardian, g);
        assertEq(uint256(av.verdict), uint256(Verdict.SAFE));
        assertEq(av.flags, 0);
        assertEq(av.weight, 1);
        assertEq(av.safeOrdinal, 1);
        assertEq(av.timestamp, uint64(block.timestamp));
        assertFalse(av.settled);
        assertFalse(av.penalized);
        assertFalse(av.castDuringDispute);

        (bool attested, uint32 index) = core.attestationIndexOf(id, g);
        assertTrue(attested);
        assertEq(index, 0);
    }

    function test_attest_notAgentIdHolder_reverts() public {
        address g = makeAddr("no-agent-id");
        address t = deployTarget();
        assertFalse(core.isAgentIdHolder(g));
        assertTrue(core.isAgentIdHolder(holder("has-id")));
        vm.expectRevert(ICore.NotAgentIdHolder.selector);
        attestAs(g, t, Verdict.SAFE, 0);
    }

    function test_attest_safeWithFlags_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        vm.expectRevert(ICore.InvalidFlags.selector);
        attestAs(g, t, Verdict.SAFE, 0x01);
    }

    function test_attest_dangerWithoutFlags_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        vm.expectRevert(ICore.InvalidFlags.selector);
        attestAs(g, t, Verdict.DANGER, 0);
    }

    function test_attest_skillFlagOnContract_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        // 0x8000 is bit 15, inside the skill mask and outside the contract mask.
        vm.expectRevert(ICore.InvalidFlags.selector);
        attestAs(g, t, Verdict.DANGER, 0x8000);
    }

    function test_attest_shortProof513Bytes_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        bytes memory tooLong = new bytes(Constants.SHORT_PROOF_MAX_BYTES + 1);
        vm.expectRevert(ICore.ShortProofTooLong.selector);
        vm.prank(g);
        core.attest(TargetType.SMART_CONTRACT, word(t), Verdict.SAFE, 0, keccak256("e"), tooLong, "ipfs://e");

        bytes memory atLimit = new bytes(Constants.SHORT_PROOF_MAX_BYTES);
        vm.prank(g);
        bytes32 id =
            core.attest(TargetType.SMART_CONTRACT, word(t), Verdict.SAFE, 0, keccak256("e"), atLimit, "ipfs://e");
        assertEq(id, Ids.targetIdOfContract(t));
    }

    function test_attest_addressWithoutCode_reverts() public {
        address g = holder("g");
        address empty = makeAddr("no-code");
        vm.expectRevert(ICore.TargetHasNoCode.selector);
        attestAs(g, empty, Verdict.SAFE, 0);
    }

    function test_attest_contractTargetWithDirtyUpperBytes_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        // The low 160 bits name a contract with code, but the upper 12 bytes are not zero.
        bytes32 dirty = bytes32(uint256(word(t)) | (uint256(1) << 160));
        vm.expectRevert(ICore.TargetHasNoCode.selector);
        vm.prank(g);
        core.attest(TargetType.SMART_CONTRACT, dirty, Verdict.SAFE, 0, keccak256("e"), "proof", "ipfs://e");
    }

    function test_attest_twiceBySameGuardian_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        bytes32 id = attestAs(g, t, Verdict.SAFE, 0);
        vm.expectRevert(ICore.AlreadyAttested.selector);
        attestAs(g, t, Verdict.SAFE, 0);
        vm.expectRevert(ICore.AlreadyAttested.selector);
        attestAs(g, t, Verdict.DANGER, 0x01);
        assertEq(core.getTarget(id).attestationCount, 1);
    }

    function test_attest_sixthInOneDay_revertsWithNextMidnight() public {
        address g = holder("g");
        for (uint256 i = 0; i < Constants.DAILY_ATTEST_LIMIT; i++) {
            attestAs(g, deployTarget(), Verdict.SAFE, 0);
        }
        // Deploy before expectRevert: a CREATE between the expectation and the call would consume it.
        address sixth = deployTarget();
        uint64 resetsAt = uint64((block.timestamp / 1 days + 1) * 1 days);
        vm.expectRevert(abi.encodeWithSelector(ICore.DailyLimitReached.selector, resetsAt));
        attestAs(g, sixth, Verdict.SAFE, 0);
    }

    function test_attest_afterMidnight_quotaIsBack() public {
        address g = holder("g");
        for (uint256 i = 0; i < Constants.DAILY_ATTEST_LIMIT; i++) {
            attestAs(g, deployTarget(), Verdict.SAFE, 0);
        }
        assertEq(core.attestationsLeftToday(g), 0);
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        assertEq(core.attestationsLeftToday(g), Constants.DAILY_ATTEST_LIMIT);
        attestAs(g, deployTarget(), Verdict.SAFE, 0);
        assertEq(core.attestationsLeftToday(g), Constants.DAILY_ATTEST_LIMIT - 1);
    }

    function test_attest_codeChangedSincePin_reverts() public {
        address g1 = holder("g1");
        address g2 = holder("g2");
        address t = deployTarget();
        attestAs(g1, t, Verdict.SAFE, 0);
        vm.etch(t, hex"6001600055");
        vm.expectRevert(ICore.CodeChangedSincePin.selector);
        attestAs(g2, t, Verdict.SAFE, 0);
    }

    function test_attest_safeOnConfirmedDanger_reverts() public {
        wireFakeModules();
        address g = holder("g");
        address t = deployTarget();
        bytes32 id = attestAs(g, t, Verdict.DANGER, 0x01);
        confirmDanger(id, 1, 0x01);
        address late = holder("late-safe");
        vm.expectRevert(ICore.SafeNotAllowedOnConfirmedDanger.selector);
        attestAs(late, t, Verdict.SAFE, 0);
    }

    function test_attest_weightIsFrozenAtVoteTime() public {
        address g = holder("g");
        address t = deployTarget();
        setScore(g, 30);
        assertEq(core.weightOf(g), 3);
        bytes32 id = attestAs(g, t, Verdict.SAFE, 0);
        assertEq(core.getAttestation(id, 0).weight, 3);

        setScore(g, 0);
        assertEq(core.weightOf(g), 1);
        assertEq(core.getAttestation(id, 0).weight, 3);
        assertEq(core.getTarget(id).safeWeight, 3);

        setScore(g, -5);
        assertEq(core.weightOf(g), 0);
        assertEq(core.getAttestation(id, 0).weight, 3);
    }

    function test_attest_safeOrdinalCountsOnlySafeVotes() public {
        address t = deployTarget();
        bytes32 id = attestAs(holder("a"), t, Verdict.SAFE, 0);
        attestAs(holder("b"), t, Verdict.DANGER, 0x01);
        attestAs(holder("c"), t, Verdict.SAFE, 0);
        assertEq(core.getAttestation(id, 0).safeOrdinal, 1);
        assertEq(core.getAttestation(id, 1).safeOrdinal, 0);
        assertEq(core.getAttestation(id, 2).safeOrdinal, 2);
        assertEq(core.getTarget(id).safeCount, 2);
        assertEq(core.getTarget(id).attestationCount, 3);
    }

    function test_attest_skill_usesHashAsTargetAndPinsNothing() public {
        address g = holder("g");
        bytes32 bundleHash = keccak256("bundle");
        vm.prank(g);
        bytes32 id =
            core.attest(TargetType.AI_SKILL_BUNDLE, bundleHash, Verdict.SAFE, 0, keccak256("e"), "proof", "ipfs://e");
        assertEq(id, Ids.targetIdOfSkill(bundleHash));
        assertEq(id, core.targetIdOfSkill(bundleHash));
        TargetView memory tv = core.getTarget(id);
        assertEq(uint256(tv.targetType), uint256(TargetType.AI_SKILL_BUNDLE));
        assertEq(tv.target, bundleHash);
        assertEq(tv.pinnedCodehash, bytes32(0));

        // A skill flag is valid on a skill target.
        bytes32 otherHash = keccak256("other-bundle");
        vm.prank(holder("g2"));
        bytes32 otherId = core.attest(
            TargetType.AI_SKILL_BUNDLE, otherHash, Verdict.DANGER, 0x0100, keccak256("e"), "proof", "ipfs://e"
        );
        assertEq(core.getTarget(otherId).activeFlags, 0x0100);
    }

    function test_attest_flagsAccumulateOnTarget() public {
        address t = deployTarget();
        bytes32 id = attestAs(holder("a"), t, Verdict.DANGER, 0x01);
        attestAs(holder("b"), t, Verdict.DANGER, 0x02);
        assertEq(core.getTarget(id).activeFlags, 0x03);
        assertEq(core.getTarget(id).dangerWeight, 2);
    }

    function test_getAttestation_outOfRange_reverts() public {
        address g = holder("g");
        address t = deployTarget();
        bytes32 id = attestAs(g, t, Verdict.SAFE, 0);
        bytes memory arrayPanic = abi.encodeWithSignature("Panic(uint256)", 0x32);
        vm.expectRevert(arrayPanic);
        core.getAttestation(id, 1);
        vm.expectRevert(arrayPanic);
        core.getAttestation(Ids.targetIdOfContract(makeAddr("unknown")), 0);
    }

    function test_attestationsLeftToday_countsDown() public {
        address g = holder("g");
        assertEq(core.attestationsLeftToday(g), Constants.DAILY_ATTEST_LIMIT);
        attestAs(g, deployTarget(), Verdict.SAFE, 0);
        assertEq(core.attestationsLeftToday(g), Constants.DAILY_ATTEST_LIMIT - 1);
        attestAs(g, deployTarget(), Verdict.SAFE, 0);
        assertEq(core.attestationsLeftToday(g), Constants.DAILY_ATTEST_LIMIT - 2);
    }

    function testFuzz_attest_weightsSumMatchesVotes(uint8 nSafe, uint8 nCaution, uint8 nDanger) public {
        nSafe = uint8(bound(nSafe, 0, 20));
        nCaution = uint8(bound(nCaution, 0, 20));
        nDanger = uint8(bound(nDanger, 0, 20));
        address t = deployTarget();
        bytes32 id = Ids.targetIdOfContract(t);
        uint256 total = uint256(nSafe) + nCaution + nDanger;
        for (uint256 i = 0; i < total; i++) {
            address g = holder(string.concat("fuzz-", vm.toString(i)));
            Verdict v = i < nSafe ? Verdict.SAFE : (i < uint256(nSafe) + nCaution ? Verdict.CAUTION : Verdict.DANGER);
            attestAs(g, t, v, v == Verdict.SAFE ? 0 : 0x01);
        }
        TargetView memory tv = core.getTarget(id);
        assertEq(tv.safeWeight, nSafe);
        assertEq(tv.cautionWeight, nCaution);
        assertEq(tv.dangerWeight, nDanger);
        assertEq(uint256(tv.safeWeight) + tv.cautionWeight + tv.dangerWeight, total);
        assertEq(tv.attestationCount, total);
        assertEq(tv.safeCount, nSafe);
    }
}
