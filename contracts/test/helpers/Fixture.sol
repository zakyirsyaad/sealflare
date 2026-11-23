// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {Test} from "forge-std/Test.sol";
import {Core} from "../../src/Core.sol";
import {Court} from "../../src/Court.sol";
import {ICore} from "../../src/interfaces/ICore.sol";
import {ICourt} from "../../src/interfaces/ICourt.sol";
import {ChallengeOutcome, ChallengeView, TargetType, Verdict} from "../../src/interfaces/Types.sol";
import {BindTypes} from "../../src/lib/BindTypes.sol";
import {Constants} from "../../src/lib/Constants.sol";
import {Vault} from "../../src/Vault.sol";
import {MockAgentID} from "../../src/stubs/MockAgentID.sol";
import {TinyTarget} from "./Mocks.sol";

/// Deploys Core against MockAgentID, then Vault and Court, and provides the actors, targets and
/// dispute helpers the tests use. Core's modules stay unset until a test calls `wireModules`, so
/// the setModules tests can still run against a fresh Core. Court-only paths in Core and Vault
/// are exercised either through Court itself or by pranking `court`.
contract Fixture is Test {
    using stdStorage for StdStorage;

    MockAgentID internal agentId;
    ICore internal core;
    address internal vault;
    address internal court;
    address internal treasury = makeAddr("treasury");

    function setUp() public virtual {
        agentId = new MockAgentID();
        core = new Core(address(agentId));
        vault = address(new Vault(address(core), treasury));
        court = address(new Court(address(core), vault));
    }

    /// Wires the real Court and Vault into Core as the deployer.
    function wireModules() public {
        core.setModules(court, vault);
    }

    // ---- dispute helpers ------------------------------------------------------------------------

    /// Opens a challenge with the exact stake and a flag valid for the target's type.
    function openChallengeAs(address who, bytes32 targetId) public returns (uint256) {
        uint32 flags = core.getTarget(targetId).targetType == TargetType.SMART_CONTRACT ? 0x01 : 0x0100;
        vm.deal(who, who.balance + Constants.CHALLENGE_STAKE);
        vm.prank(who);
        return ICourt(court).openChallenge{value: Constants.CHALLENGE_STAKE}(
            targetId, flags, keccak256("challenge"), "proof", "ipfs://challenge"
        );
    }

    function commitAs(address juror, uint256 id, bool uphold, bytes32 salt) public {
        bytes32 hash = ICourt(court).commitHashOf(id, juror, uphold, salt);
        vm.deal(juror, juror.balance + Constants.JURY_STAKE);
        vm.prank(juror);
        ICourt(court).commitVote{value: Constants.JURY_STAKE}(id, hash);
    }

    function revealAs(address juror, uint256 id, bool uphold, bytes32 salt) public {
        vm.prank(juror);
        ICourt(court).revealVote(id, uphold, salt);
    }

    function toCommitPhaseEnd(uint256 id) public {
        ChallengeView memory c = ICourt(court).getChallenge(id);
        vm.warp(c.commitEndsAt);
    }

    function toRevealPhaseEnd(uint256 id) public {
        ChallengeView memory c = ICourt(court).getChallenge(id);
        vm.warp(c.revealEndsAt);
    }

    /// An Agent ID holder with a Guardian profile and the given score. The profile comes from a
    /// SAFE vote on a target of its own, so it never counts as having attested the disputed one.
    /// Call before the challenge opens, then roll a block, or the profile is too new to judge.
    function juror(string memory name, int32 score) public returns (address who) {
        who = holder(name);
        attestAs(who, deployTarget(), Verdict.SAFE, 0);
        setScore(who, score);
    }

    /// Confirms `targetId` dangerous through the Court-only path, as an upheld challenge would.
    function confirmDanger(bytes32 targetId, uint256 challengeId, uint32 flags) public {
        vm.startPrank(court);
        core.markDisputed(targetId, challengeId);
        core.applyVerdict(targetId, challengeId, ChallengeOutcome.UPHELD, flags);
        vm.stopPrank();
    }

    /// A named address holding one Agent ID and 10 BNB.
    function holder(string memory name) public returns (address who) {
        who = makeAddr(name);
        vm.deal(who, 10 ether);
        agentId.setBalance(who, 1);
    }

    /// Deploys a small contract with code and returns its address.
    function deployTarget() public returns (address) {
        return address(new TinyTarget());
    }

    /// The bytes32 target word for a contract address.
    function word(address target) public pure returns (bytes32) {
        return bytes32(uint256(uint160(target)));
    }

    /// Attests on a contract target as `who`, with standard evidence fields.
    function attestAs(address who, address target, Verdict v, uint32 flags) public returns (bytes32) {
        vm.prank(who);
        return core.attest(
            TargetType.SMART_CONTRACT, word(target), v, flags, keccak256("evidence"), "proof", "ipfs://evidence"
        );
    }

    /// Signs BindByOwner for `target` with the target's current bindNonce and Core's domain.
    function signBindByOwner(uint256 pk, address target, address agentIdHolder, uint256 deadline)
        public
        view
        returns (bytes memory)
    {
        bytes32 structHash = BindTypes.hashBindByOwner(target, agentIdHolder, core.bindNonce(target), deadline);
        return signDigest(pk, core.DOMAIN_SEPARATOR(), structHash);
    }

    /// Signs BindByDeployer for `target` with the target's current bindNonce and Core's domain.
    function signBindByDeployer(
        uint256 pk,
        address target,
        address deployer_,
        uint256 deployNonce,
        address agentIdHolder,
        uint256 deadline
    ) public view returns (bytes memory) {
        bytes32 structHash = BindTypes.hashBindByDeployer(
            target, deployer_, deployNonce, agentIdHolder, core.bindNonce(target), deadline
        );
        return signDigest(pk, core.DOMAIN_SEPARATOR(), structHash);
    }

    /// An EIP-712 signature over `structHash` under `domain`, packed as r, s, v.
    function signDigest(uint256 pk, bytes32 domain, bytes32 structHash) public pure returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Moves a guardian's score without Core.settle (Task 4). GuardianView packs `score` into the
    /// struct's first storage slot; stdstore locates it through getGuardian and patches only those
    /// bits, leaving exists, createdAtBlock and the quota fields untouched.
    function setScore(address guardian, int32 score) public {
        stdstore.target(address(core)).sig("getGuardian(address)").with_key(guardian).depth(1).enable_packed_slots()
            .checked_write_int(int256(score));
    }
}
