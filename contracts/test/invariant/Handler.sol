// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ICore} from "../../src/interfaces/ICore.sol";
import {ICourt} from "../../src/interfaces/ICourt.sol";
import {IVault} from "../../src/interfaces/IVault.sol";
import {ChallengeOutcome, PublisherRole, TargetType, TargetView, Verdict} from "../../src/interfaces/Types.sol";
import {Constants} from "../../src/lib/Constants.sol";
import {Rules} from "../../src/lib/Rules.sol";
import {TinyTarget} from "../helpers/Mocks.sol";

/// Drives random protocol activity for the Vault invariants: 8 Agent ID holders and 3 contract
/// targets. An action that cannot run reverts instead of returning, so "calls - reverts" in the
/// invariant metrics counts the actions that really happened. Arguments that need a call to Core are computed before `vm.prank`, which would
/// otherwise be spent on that call. Every BNB the handler sends into Vault is added to `totalIn`, every BNB withdrawn to
/// `totalOut`. With fail_on_revert off a reverted action changes nothing, ghost variables
/// included.
contract Handler is Test {
    ICore public immutable core;
    IVault public immutable vault;
    ICourt public immutable court;
    address public immutable treasury;

    uint256 public constant ACTORS = 8;
    /// Actors 0 to 3 attest, sponsor, challenge and fund bounties. Actors 4 to 7 only judge: their
    /// profiles come from a target nobody challenges, so they stay eligible on the three targets.
    uint256 public constant COMMUNITY = 4;
    uint256 public constant TARGETS = 3;

    address[] public actors;
    address[] public targets;
    uint256[] public challengeIds;
    uint256[] public bountyIds;

    uint256 public totalIn;
    uint256 public totalOut;
    mapping(bytes32 => bool) public upheld;
    mapping(address => int256) public ghostScore;
    /// Set when Core emitted a ScoreChanged delta that no rule produces.
    bool public sawForeignDelta;
    mapping(uint256 => mapping(address => bool)) internal _committedUphold;

    constructor(ICore core_, IVault vault_, ICourt court_, address agentId, address[] memory targets_) {
        core = core_;
        vault = vault_;
        court = court_;
        treasury = vault_.treasury();
        targets = targets_;
        for (uint256 i = 0; i < ACTORS; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            vm.deal(a, 1000 ether);
            (bool ok,) = agentId.call(abi.encodeWithSignature("setBalance(address,uint256)", a, 1));
            require(ok, "agent id setup");
        }
        address profileTarget = address(new TinyTarget());
        for (uint256 i = COMMUNITY; i < ACTORS; ++i) {
            vm.prank(actors[i]);
            core_.attest(
                TargetType.SMART_CONTRACT, bytes32(uint256(uint160(profileTarget))), Verdict.SAFE, 0, 0, "", ""
            );
        }
    }

    // ---- bookkeeping --------------------------------------------------------------------------

    /// Folds every ScoreChanged that Core emitted during the action into `ghostScore`.
    modifier recordScores() {
        vm.recordLogs();
        _;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(core) || logs[i].topics[0] != ICore.ScoreChanged.selector) continue;
            address guardian = address(uint160(uint256(logs[i].topics[1])));
            (int32 delta,,) = abi.decode(logs[i].data, (int32, int32, uint8));
            if (!_isRuleDelta(delta)) sawForeignDelta = true;
            ghostScore[guardian] += delta;
        }
    }

    function _isRuleDelta(int32 d) internal pure returns (bool) {
        return d == Rules.XP_EARLY_SAFE || d == Rules.XP_CONFIRMING_SAFE || d == Rules.XP_DANGER_CONFIRMED
            || d == Rules.XP_SAFE_ON_DANGER || d == Rules.XP_JUROR_MAJORITY || d == Rules.XP_CHALLENGER_WON
            || d == Rules.XP_CHALLENGER_LOST;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % ACTORS];
    }

    function _member(uint256 seed) internal view returns (address) {
        return actors[seed % COMMUNITY];
    }

    function _juror(uint256 seed) internal view returns (address) {
        return actors[COMMUNITY + seed % (ACTORS - COMMUNITY)];
    }

    function _target(uint256 seed) internal view returns (address) {
        return targets[seed % TARGETS];
    }

    function _targetId(uint256 seed) internal view returns (bytes32) {
        return core.targetIdOfContract(_target(seed));
    }

    /// Three times in four the newest challenge, so commits, reveals and closing meet on the
    /// same dispute; otherwise any earlier one.
    function _challenge(uint256 seed) internal view returns (uint256) {
        uint256 n = challengeIds.length;
        if (n == 0) return 0;
        return seed % 4 == 0 ? challengeIds[(seed / 4) % n] : challengeIds[n - 1];
    }

    /// The target's publisher of record, or zero. The handler never rebinds a publisher, so this
    /// is also whoever deposited the target's bond.
    function _publisher(bytes32 id) internal view returns (address) {
        TargetView memory t = core.getTarget(id);
        return t.publisherRole == PublisherRole.NONE ? address(0) : t.publisher;
    }

    // ---- Core ---------------------------------------------------------------------------------

    function attest(uint256 actorSeed, uint256 targetSeed, uint256 verdictSeed) external {
        Verdict v = Verdict(verdictSeed % 3);
        address a = _member(actorSeed);
        bytes32 word = bytes32(uint256(uint160(_target(targetSeed))));
        vm.prank(a);
        core.attest(TargetType.SMART_CONTRACT, word, v, v == Verdict.SAFE ? 0 : 0x01, bytes32(0), "", "");
    }

    function sponsor(uint256 actorSeed, uint256 targetSeed) external {
        bytes32 id = _targetId(targetSeed);
        vm.prank(_member(actorSeed));
        core.sponsor(id);
    }

    function settle(uint256 targetSeed) external recordScores {
        core.settle(_targetId(targetSeed), 0, type(uint32).max);
    }

    function applyPenalties(uint256 targetSeed) external recordScores {
        core.applyPenalties(_targetId(targetSeed), 0, type(uint32).max);
    }

    // ---- bonds --------------------------------------------------------------------------------

    /// Deposits as the target's publisher of record, the only account Vault accepts.
    function depositBond(uint256 targetSeed, uint256 amount) external {
        amount = bound(amount, 1, Constants.MAX_WARRANTY_BOND);
        bytes32 id = _targetId(targetSeed);
        address pub = _publisher(id);
        require(pub != address(0), "no publisher");
        vm.prank(pub);
        vault.depositBond{value: amount}(id);
        totalIn += amount;
    }

    function requestBondWithdrawal(uint256 targetSeed) external {
        bytes32 id = _targetId(targetSeed);
        address pub = _publisher(id);
        require(pub != address(0), "no publisher");
        vm.prank(pub);
        vault.requestBondWithdrawal(id);
    }

    function finalizeBondWithdrawal(uint256 targetSeed) external {
        bytes32 id = _targetId(targetSeed);
        address pub = _publisher(id);
        require(pub != address(0), "no publisher");
        vm.prank(pub);
        vault.finalizeBondWithdrawal(id);
    }

    // ---- bounties -----------------------------------------------------------------------------

    function createBounty(uint256 actorSeed, uint256 targetSeed, uint256 slots, uint256 amount) external {
        slots = bound(slots, Constants.BOUNTY_MIN_SLOTS, Constants.BOUNTY_MAX_SLOTS);
        amount = bound(amount, 1, Constants.MAX_BOUNTY);
        bytes32 id = _targetId(targetSeed);
        vm.prank(_member(actorSeed));
        bountyIds.push(vault.createBounty{value: amount}(id, uint8(slots)));
        totalIn += amount;
    }

    function settleBounty(uint256 seed) external {
        require(bountyIds.length != 0, "no bounty");
        vault.settleBounty(bountyIds[seed % bountyIds.length]);
    }

    // ---- disputes -----------------------------------------------------------------------------

    function openChallenge(uint256 actorSeed, uint256 targetSeed) external {
        bytes32 targetId = _targetId(targetSeed);
        vm.prank(_member(actorSeed));
        uint256 id = court.openChallenge{value: Constants.CHALLENGE_STAKE}(targetId, 0x01, bytes32(0), "", "");
        challengeIds.push(id);
        totalIn += Constants.CHALLENGE_STAKE;
    }

    function commitVote(uint256 actorSeed, uint256 challengeSeed, bool uphold) external {
        uint256 id = _challenge(challengeSeed);
        address a = _juror(actorSeed);
        bytes32 hash = court.commitHashOf(id, a, uphold, keccak256(abi.encode(a)));
        vm.prank(a);
        court.commitVote{value: Constants.JURY_STAKE}(id, hash);
        _committedUphold[id][a] = uphold;
        totalIn += Constants.JURY_STAKE;
    }

    /// Reveals every juror who committed on the chosen challenge, skipping those who cannot.
    function revealVote(uint256 challengeSeed) external {
        uint256 id = _challenge(challengeSeed);
        bool revealed;
        for (uint256 i = COMMUNITY; i < ACTORS; ++i) {
            address a = actors[i];
            bool uphold = _committedUphold[id][a];
            bytes32 salt = keccak256(abi.encode(a));
            vm.prank(a);
            try court.revealVote(id, uphold, salt) {
                revealed = true;
            } catch {}
        }
        require(revealed, "nothing revealed");
    }

    function resolve(uint256 challengeSeed) external recordScores {
        uint256 id = _challenge(challengeSeed);
        court.resolve(id);
        if (court.getChallenge(id).outcome == ChallengeOutcome.UPHELD) upheld[court.getChallenge(id).targetId] = true;
    }

    function expire(uint256 challengeSeed) external recordScores {
        court.expire(_challenge(challengeSeed));
    }

    /// One whole dispute in a single action: open, every juror commits a random direction, a
    /// random subset reveals, then it closes by resolve or expire as the reveal count decides.
    /// The step-by-step actions above interleave with other activity; this one makes sure the
    /// closing paths, and what depends on them, run in every campaign.
    function runDispute(uint256 actorSeed, uint256 targetSeed, uint8 upholdMask, uint8 revealMask)
        external
        recordScores
    {
        bytes32 targetId = _targetId(targetSeed);
        vm.roll(block.number + 1); // juror profiles must predate the challenge's block
        vm.prank(_member(actorSeed));
        uint256 id = court.openChallenge{value: Constants.CHALLENGE_STAKE}(targetId, 0x01, bytes32(0), "", "");
        challengeIds.push(id);
        totalIn += Constants.CHALLENGE_STAKE;
        _commitAll(id, upholdMask);
        vm.warp(court.getChallenge(id).commitEndsAt);
        _revealSome(id, revealMask);
        vm.warp(court.getChallenge(id).revealEndsAt);
        if (court.getChallenge(id).reveals >= Constants.MIN_REVEALS) {
            court.resolve(id);
            if (court.getChallenge(id).outcome == ChallengeOutcome.UPHELD) upheld[targetId] = true;
        } else {
            court.expire(id);
        }
    }

    function _commitAll(uint256 id, uint8 upholdMask) internal {
        for (uint256 i = COMMUNITY; i < ACTORS; ++i) {
            address a = actors[i];
            bool uphold = (upholdMask >> (i - COMMUNITY)) & 1 == 1;
            bytes32 hash = court.commitHashOf(id, a, uphold, keccak256(abi.encode(a)));
            vm.prank(a);
            try court.commitVote{value: Constants.JURY_STAKE}(id, hash) {
                _committedUphold[id][a] = uphold;
                totalIn += Constants.JURY_STAKE;
            } catch {}
        }
    }

    function _revealSome(uint256 id, uint8 revealMask) internal {
        for (uint256 i = COMMUNITY; i < ACTORS; ++i) {
            if ((revealMask >> (i - COMMUNITY)) & 1 == 0) continue;
            address a = actors[i];
            vm.prank(a);
            try court.revealVote(id, _committedUphold[id][a], keccak256(abi.encode(a))) {} catch {}
        }
    }

    // ---- balances and time ---------------------------------------------------------------------

    /// Seed 8 withdraws for the treasury, every other seed for an actor.
    function withdraw(uint256 seed) external {
        address who = seed % (ACTORS + 1) == ACTORS ? treasury : _actor(seed);
        uint256 amount = vault.balanceOf(who);
        require(amount != 0, "nothing to withdraw");
        vm.prank(who);
        vault.withdraw();
        totalOut += amount;
    }

    /// Moves time and the block, so profiles age past a challenge's opening block and windows
    /// close. Most steps stay under a day so commit and reveal windows are hit; one in eight
    /// jumps 8 days so unbonding, bounty timeouts and cooldowns run out too.
    function warp(uint256 seconds_) external {
        uint256 step = seconds_ % 8 == 0 ? 8 days : bound(seconds_, 1 hours, 1 days);
        vm.warp(block.timestamp + step);
        vm.roll(block.number + 1);
    }

    // ---- views for the invariants --------------------------------------------------------------

    function actorCount() external pure returns (uint256) {
        return ACTORS;
    }

    function challengeCount() external view returns (uint256) {
        return challengeIds.length;
    }

    function bountyCount() external view returns (uint256) {
        return bountyIds.length;
    }
}
