// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICore} from "../interfaces/ICore.sol";
import {ICourt} from "../interfaces/ICourt.sol";
import {IVault} from "../interfaces/IVault.sol";
import {ChallengeOutcome, ChallengePhase, ChallengeView, JurorStatus, JurorView} from "../interfaces/Types.sol";
import {Constants} from "../lib/Constants.sol";

/// @dev Local development only. Never deploy to a public network.
/// Emits the final Court events with real time windows. It checks no eligibility, no stake amount
/// and no commitment, and it splits no money: resolve and expire only record the outcome.
contract CourtStub is ICourt {
    address public immutable core;
    address public immutable vault;

    uint256 internal _count;
    mapping(uint256 => ChallengeView) internal _challenges;
    mapping(bytes32 => uint256) public activeChallengeOf;
    mapping(uint256 => mapping(address => JurorView)) internal _jurors;
    mapping(uint256 => bool) internal _phaseForced;
    mapping(uint256 => ChallengePhase) internal _forcedPhase;
    mapping(uint256 => mapping(address => JurorStatus)) internal _status;

    error LocalChainOnly();

    constructor(address core_, address vault_) {
        if (block.chainid != 31337) revert LocalChainOnly();
        core = core_;
        vault = vault_;
    }

    // ---- test setters -------------------------------------------------------------------------

    function stubSetChallenge(uint256 id, ChallengeView calldata value) external {
        _challenges[id] = value;
        if (id > _count) _count = id;
    }

    function stubSetPhase(uint256 id, ChallengePhase phase) external {
        _phaseForced[id] = true;
        _forcedPhase[id] = phase;
    }

    function stubSetJuror(uint256 id, address juror, JurorView calldata value) external {
        _jurors[id][juror] = value;
    }

    function stubSetJurorStatus(uint256 id, address account, JurorStatus status) external {
        _status[id][account] = status;
    }

    // ---- writes -------------------------------------------------------------------------------

    function openChallenge(
        bytes32 targetId,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external payable returns (uint256 id) {
        id = ++_count;
        uint64 commitEndsAt = uint64(block.timestamp) + Constants.COMMIT_WINDOW;
        uint64 revealEndsAt = commitEndsAt + Constants.REVEAL_WINDOW;
        ChallengeView storage c = _challenges[id];
        c.targetId = targetId;
        c.challenger = msg.sender;
        c.flags = flags;
        c.evidenceHash = evidenceHash;
        c.evidenceURI = evidenceURI;
        c.openedAt = uint64(block.timestamp);
        c.openedAtBlock = uint64(block.number);
        c.commitEndsAt = commitEndsAt;
        c.revealEndsAt = revealEndsAt;
        activeChallengeOf[targetId] = id;

        IVault(vault).depositStake{value: msg.value}(id, msg.sender);
        IVault(vault).lockBond(id, targetId);
        ICore(core).markDisputed(targetId, id);
        emit ChallengeOpened(
            id, targetId, msg.sender, flags, evidenceHash, shortProof, evidenceURI, commitEndsAt, revealEndsAt
        );
    }

    function submitCounterEvidence(uint256 id, string calldata uri) external {
        _challenges[id].counterEvidenceURI = uri;
        emit CounterEvidenceSubmitted(id, msg.sender, uri);
    }

    function commitVote(uint256 id, bytes32 commitHash) external payable {
        uint8 weight = ICore(core).weightOf(msg.sender);
        _jurors[id][msg.sender] = JurorView(true, false, false, weight, commitHash);
        _challenges[id].commits += 1;
        IVault(vault).depositStake{value: msg.value}(id, msg.sender);
        emit VoteCommitted(id, msg.sender, weight);
    }

    function revealVote(uint256 id, bool uphold, bytes32) external {
        JurorView storage j = _jurors[id][msg.sender];
        ChallengeView storage c = _challenges[id];
        j.revealed = true;
        j.uphold = uphold;
        c.reveals += 1;
        if (uphold) c.upholdWeight += j.weight;
        else c.rejectWeight += j.weight;
        emit VoteRevealed(id, msg.sender, uphold, j.weight);
    }

    function resolve(uint256 id) external {
        ChallengeView storage c = _challenges[id];
        ChallengeOutcome outcome = c.upholdWeight == c.rejectWeight
            ? ChallengeOutcome.TIED
            : (c.upholdWeight > c.rejectWeight ? ChallengeOutcome.UPHELD : ChallengeOutcome.REJECTED);
        _close(id, outcome);
        emit ChallengeResolved(id, outcome, c.upholdWeight, c.rejectWeight);
    }

    function expire(uint256 id) external {
        _close(id, ChallengeOutcome.EXPIRED);
        emit ChallengeExpired(id, _challenges[id].reveals, Constants.expireForfeitBps(0));
    }

    // ---- views --------------------------------------------------------------------------------

    function commitHashOf(uint256 id, address juror, bool uphold, bytes32 salt) external pure returns (bytes32) {
        return keccak256(abi.encode(id, juror, uphold, salt));
    }

    function getChallenge(uint256 id) external view returns (ChallengeView memory) {
        return _challenges[id];
    }

    function phaseOf(uint256 id) external view returns (ChallengePhase) {
        if (_phaseForced[id]) return _forcedPhase[id];
        ChallengeView storage c = _challenges[id];
        if (c.openedAt == 0) return ChallengePhase.NONE;
        if (c.outcome != ChallengeOutcome.PENDING) return ChallengePhase.CLOSED;
        if (block.timestamp < c.commitEndsAt) return ChallengePhase.COMMIT;
        if (block.timestamp < c.revealEndsAt) return ChallengePhase.REVEAL;
        return ChallengePhase.AWAITING_CLOSE;
    }

    function getJuror(uint256 id, address juror) external view returns (JurorView memory) {
        return _jurors[id][juror];
    }

    function jurorStatus(uint256 id, address account) external view returns (JurorStatus) {
        return _status[id][account];
    }

    function cooldownEndsAt(address, bytes32) external pure returns (uint64) {
        return 0;
    }

    function nextExpireForfeitBps(bytes32) external pure returns (uint16) {
        return Constants.expireForfeitBps(0);
    }

    function _close(uint256 id, ChallengeOutcome outcome) internal {
        ChallengeView storage c = _challenges[id];
        c.outcome = outcome;
        activeChallengeOf[c.targetId] = 0;
        IVault(vault).settleBond(id, outcome == ChallengeOutcome.UPHELD ? Constants.BOND_SLASH_BPS : 0);
        ICore(core).applyVerdict(c.targetId, id, outcome, c.flags);
    }
}
