// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICore} from "./interfaces/ICore.sol";
import {ICourt} from "./interfaces/ICourt.sol";
import {IVault} from "./interfaces/IVault.sol";
import {
    ChallengeOutcome,
    ChallengePhase,
    ChallengeView,
    GuardianView,
    JurorStatus,
    JurorView,
    PublisherRole,
    ScoreReason,
    TargetView,
    Verdict
} from "./interfaces/Types.sol";
import {Constants} from "./lib/Constants.sol";
import {Rules} from "./lib/Rules.sol";

/// Disputes: challenge, counter evidence, commit, reveal, verdict, expiry. Holds no funds: every
/// stake is forwarded to the Vault escrow of its challenge within the same call.
contract Court is ICourt {
    address public immutable core;
    address public immutable vault;

    uint256 internal _challengeCount;
    mapping(uint256 => ChallengeView) internal _challenges;
    mapping(uint256 => mapping(address => JurorView)) internal _jurors;
    mapping(uint256 => address[]) internal _jurorList;
    mapping(bytes32 => uint256) public activeChallengeOf;
    mapping(address => mapping(bytes32 => uint64)) public cooldownEndsAt;
    /// The two most recent expiry times per target, newest first (D11).
    mapping(bytes32 => uint64[2]) internal _recentExpiries;

    constructor(address core_, address vault_) {
        core = core_;
        vault = vault_;
    }

    // ---- opening ------------------------------------------------------------------------------

    function openChallenge(
        bytes32 targetId,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external payable returns (uint256 id) {
        _checkOpen(targetId, flags, shortProof.length);
        id = ++_challengeCount;
        ChallengeView storage c = _challenges[id];
        c.targetId = targetId;
        c.challenger = msg.sender;
        c.flags = flags;
        c.evidenceHash = evidenceHash;
        c.evidenceURI = evidenceURI;
        c.openedAt = uint64(block.timestamp);
        c.openedAtBlock = uint64(block.number);
        c.commitEndsAt = uint64(block.timestamp) + Constants.COMMIT_WINDOW;
        c.revealEndsAt = c.commitEndsAt + Constants.REVEAL_WINDOW;
        activeChallengeOf[targetId] = id;
        emit ChallengeOpened(
            id, targetId, msg.sender, flags, evidenceHash, shortProof, evidenceURI, c.commitEndsAt, c.revealEndsAt
        );
        IVault(vault).depositStake{value: msg.value}(id, msg.sender);
        IVault(vault).lockBond(id, targetId);
        ICore(core).markDisputed(targetId, id);
    }

    /// Cheapest and most informative checks first. A challenge alleges a specific violation, so it
    /// takes the DANGER flag rule: at least one flag, all inside the target type's mask (D12).
    function _checkOpen(bytes32 targetId, uint32 flags, uint256 proofLength) internal view {
        if (!ICore(core).isAgentIdHolder(msg.sender)) revert NotAgentIdHolder();
        if (msg.value != Constants.CHALLENGE_STAKE) revert WrongStake(Constants.CHALLENGE_STAKE);
        if (proofLength > Constants.SHORT_PROOF_MAX_BYTES) revert ShortProofTooLong();
        TargetView memory t = ICore(core).getTarget(targetId);
        if (t.createdAt == 0) revert TargetNotFound();
        if (!Rules.isValidFlags(t.targetType, Verdict.DANGER, flags)) revert InvalidFlags();
        if (t.confirmedDanger) revert TargetAlreadyConfirmedDanger();
        uint256 active = activeChallengeOf[targetId];
        if (active != 0) revert ChallengeAlreadyActive(active);
        uint64 endsAt = cooldownEndsAt[msg.sender][targetId];
        if (block.timestamp < endsAt) revert InCooldown(endsAt);
    }

    /// Only the verified publisher may answer, and only while jurors can still commit.
    function submitCounterEvidence(uint256 id, string calldata uri) external {
        ChallengePhase phase = phaseOf(id);
        if (phase != ChallengePhase.COMMIT) revert WrongPhase(phase);
        TargetView memory t = ICore(core).getTarget(_challenges[id].targetId);
        if (t.publisherRole != PublisherRole.VERIFIED_PUBLISHER || t.publisher != msg.sender) revert NotPublisher();
        _challenges[id].counterEvidenceURI = uri;
        emit CounterEvidenceSubmitted(id, msg.sender, uri);
    }

    // ---- jury ---------------------------------------------------------------------------------

    /// The juror's weight is frozen here. The direction stays hidden until reveal.
    function commitVote(uint256 id, bytes32 commitHash) external payable {
        JurorStatus status = jurorStatus(id, msg.sender);
        if (status != JurorStatus.ELIGIBLE) revert NotEligibleJuror(status);
        if (msg.value != Constants.JURY_STAKE) revert WrongStake(Constants.JURY_STAKE);
        uint8 weight = ICore(core).weightOf(msg.sender);
        _jurors[id][msg.sender] = JurorView(true, false, false, weight, commitHash);
        _jurorList[id].push(msg.sender);
        _challenges[id].commits += 1;
        emit VoteCommitted(id, msg.sender, weight);
        IVault(vault).depositStake{value: msg.value}(id, msg.sender);
    }

    function revealVote(uint256 id, bool uphold, bytes32 salt) external {
        ChallengePhase phase = phaseOf(id);
        if (phase != ChallengePhase.REVEAL) revert WrongPhase(phase);
        JurorView storage j = _jurors[id][msg.sender];
        if (!j.committed) revert CommitMismatch();
        if (j.revealed) revert AlreadyRevealed();
        if (commitHashOf(id, msg.sender, uphold, salt) != j.commitHash) revert CommitMismatch();
        j.revealed = true;
        j.uphold = uphold;
        ChallengeView storage c = _challenges[id];
        c.reveals += 1;
        if (uphold) c.upholdWeight += j.weight;
        else c.rejectWeight += j.weight;
        emit VoteRevealed(id, msg.sender, uphold, j.weight);
    }

    /// First failing check wins, in the order the plan fixes for Task 8.
    function jurorStatus(uint256 id, address account) public view returns (JurorStatus) {
        if (phaseOf(id) != ChallengePhase.COMMIT) return JurorStatus.NOT_IN_COMMIT_PHASE;
        ICore c0 = ICore(core);
        if (!c0.isAgentIdHolder(account)) return JurorStatus.NOT_AGENT_ID_HOLDER;
        if (_jurors[id][account].committed) return JurorStatus.ALREADY_COMMITTED;
        ChallengeView storage c = _challenges[id];
        if (account == c.challenger) return JurorStatus.IS_CHALLENGER;
        return _conflictOrStanding(c0, c, account);
    }

    /// The checks that need Core's view of the target and of the account.
    function _conflictOrStanding(ICore c0, ChallengeView storage c, address account)
        internal
        view
        returns (JurorStatus)
    {
        TargetView memory t = c0.getTarget(c.targetId);
        if (t.publisherRole != PublisherRole.NONE && t.publisher == account) return JurorStatus.IS_PUBLISHER;
        (bool attested,) = c0.attestationIndexOf(c.targetId, account);
        if (attested) return JurorStatus.HAS_ATTESTED;
        GuardianView memory g = c0.getGuardian(account);
        if (!g.exists || g.createdAtBlock >= c.openedAtBlock) return JurorStatus.PROFILE_TOO_NEW;
        if (g.score < 0) return JurorStatus.NEGATIVE_SCORE;
        if (c.commits >= Constants.MAX_JURORS) return JurorStatus.JURY_FULL;
        return JurorStatus.ELIGIBLE;
    }

    // ---- views --------------------------------------------------------------------------------

    function commitHashOf(uint256 id, address juror, bool uphold, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(id, juror, uphold, salt));
    }

    function phaseOf(uint256 id) public view returns (ChallengePhase) {
        ChallengeView storage c = _challenges[id];
        if (c.openedAt == 0) return ChallengePhase.NONE;
        if (c.outcome != ChallengeOutcome.PENDING) return ChallengePhase.CLOSED;
        if (block.timestamp < c.commitEndsAt) return ChallengePhase.COMMIT;
        if (block.timestamp < c.revealEndsAt) return ChallengePhase.REVEAL;
        return ChallengePhase.AWAITING_CLOSE;
    }

    function getChallenge(uint256 id) external view returns (ChallengeView memory) {
        return _challenges[id];
    }

    function getJuror(uint256 id, address juror) external view returns (JurorView memory) {
        return _jurors[id][juror];
    }

    /// 20% after no recent expiry on the target, 50% after one, 100% after two, counting only
    /// expiries within the last 30 days, whoever the challenger was (architecture 4.7, D11).
    function nextExpireForfeitBps(bytes32 targetId) public view returns (uint16) {
        uint64[2] storage recent = _recentExpiries[targetId];
        uint256 prior;
        for (uint256 i = 0; i < 2; ++i) {
            if (recent[i] != 0 && block.timestamp < uint256(recent[i]) + Constants.EXPIRE_REPEAT_WINDOW) ++prior;
        }
        return Constants.expireForfeitBps(prior);
    }

    // ---- closing ------------------------------------------------------------------------------

    /// Recipients and amounts for one `distribute` call, sized for every juror plus the
    /// challenger and the treasury. Zero amounts are never added.
    struct Payout {
        address[] to;
        uint256[] amounts;
        uint256 count;
        uint256 sum;
    }

    /// After the reveal window with at least three reveals. Order: checks, Court's own state,
    /// bond, funds, scores, verdict, event (architecture 4.8).
    function resolve(uint256 id) external {
        ChallengeView storage c = _closable(id);
        if (c.reveals < Constants.MIN_REVEALS) revert QuorumNotReached();
        ChallengeOutcome outcome = c.upholdWeight > c.rejectWeight
            ? ChallengeOutcome.UPHELD
            : c.rejectWeight > c.upholdWeight ? ChallengeOutcome.REJECTED : ChallengeOutcome.TIED;
        c.outcome = outcome;
        activeChallengeOf[c.targetId] = 0;
        if (outcome != ChallengeOutcome.UPHELD) _startCooldown(c);
        uint16 slashBps = outcome == ChallengeOutcome.UPHELD ? Constants.BOND_SLASH_BPS : 0;
        (uint256 slashed,) = IVault(vault).settleBond(id, slashBps);
        Payout memory p = _resolvePayout(id, c, outcome, slashed);
        IVault(vault).distribute(id, p.to, p.amounts);
        _adjustScores(id, c, outcome);
        ICore(core).applyVerdict(c.targetId, id, outcome, c.flags);
        emit ChallengeResolved(id, outcome, c.upholdWeight, c.rejectWeight);
    }

    /// After the reveal window with fewer than three reveals. The challenger forfeits 20%, 50% or
    /// 100% by the target's recent expiries and may not challenge this target again for 7 days.
    function expire(uint256 id) external {
        ChallengeView storage c = _closable(id);
        if (c.reveals >= Constants.MIN_REVEALS) revert QuorumReached();
        uint16 forfeitBps = nextExpireForfeitBps(c.targetId);
        c.outcome = ChallengeOutcome.EXPIRED;
        activeChallengeOf[c.targetId] = 0;
        uint64[2] storage recent = _recentExpiries[c.targetId];
        recent[1] = recent[0];
        recent[0] = uint64(block.timestamp);
        _startCooldown(c);
        IVault(vault).settleBond(id, 0);
        Payout memory p = _newPayout(id);
        _add(p, c.challenger, Constants.CHALLENGE_STAKE * (Constants.BPS - forfeitBps) / Constants.BPS);
        _addRevealedStakes(p, id);
        _finish(p, _escrowTotal(c, 0));
        IVault(vault).distribute(id, p.to, p.amounts);
        ICore(core).applyVerdict(c.targetId, id, ChallengeOutcome.EXPIRED, c.flags);
        emit ChallengeExpired(id, c.reveals, forfeitBps);
    }

    /// Every challenge that does not end in a danger verdict bars the same challenger from that
    /// target for 7 days, so a lost or tied challenge cannot be reopened in the next block to
    /// keep the target disputed and its bond locked (D22).
    function _startCooldown(ChallengeView storage c) internal {
        cooldownEndsAt[c.challenger][c.targetId] = uint64(block.timestamp) + Constants.CHALLENGE_COOLDOWN;
    }

    function _closable(uint256 id) internal view returns (ChallengeView storage) {
        ChallengePhase phase = phaseOf(id);
        if (phase == ChallengePhase.CLOSED) revert ChallengeClosed();
        if (phase != ChallengePhase.AWAITING_CLOSE) revert WrongPhase(phase);
        return _challenges[id];
    }

    /// Upheld: the challenger gets C + pool / 2 and each majority juror J + the other half / n.
    /// Rejected: each majority juror gets J + pool / n. Tied: every revealed stake comes back.
    /// The pool is everything in escrow that is not a stake being returned; the treasury takes
    /// what rounding leaves (architecture 4.8, D13).
    function _resolvePayout(uint256 id, ChallengeView storage c, ChallengeOutcome outcome, uint256 slashed)
        internal
        view
        returns (Payout memory p)
    {
        p = _newPayout(id);
        uint256 total = _escrowTotal(c, slashed);
        if (outcome == ChallengeOutcome.TIED) {
            _add(p, c.challenger, Constants.CHALLENGE_STAKE);
            _addRevealedStakes(p, id);
            _finish(p, total);
            return p;
        }
        bool upholdWins = outcome == ChallengeOutcome.UPHELD;
        uint256 n = _majorityCount(id, upholdWins);
        uint256 pool = total - Constants.JURY_STAKE * n - (upholdWins ? Constants.CHALLENGE_STAKE : 0);
        uint256 challengerShare = upholdWins ? pool / 2 : 0;
        if (upholdWins) _add(p, c.challenger, Constants.CHALLENGE_STAKE + challengerShare);
        uint256 each = Constants.JURY_STAKE + (pool - challengerShare) / n;
        address[] storage js = _jurorList[id];
        for (uint256 i = 0; i < js.length; ++i) {
            if (_isMajority(_jurors[id][js[i]], upholdWins)) _add(p, js[i], each);
        }
        _finish(p, total);
    }

    function _adjustScores(uint256 id, ChallengeView storage c, ChallengeOutcome outcome) internal {
        if (outcome != ChallengeOutcome.UPHELD && outcome != ChallengeOutcome.REJECTED) return;
        bool upholdWins = outcome == ChallengeOutcome.UPHELD;
        ICore c0 = ICore(core);
        if (upholdWins) c0.adjustScore(c.challenger, c.targetId, Rules.XP_CHALLENGER_WON, ScoreReason.CHALLENGER_WON);
        else c0.adjustScore(c.challenger, c.targetId, Rules.XP_CHALLENGER_LOST, ScoreReason.CHALLENGER_LOST);
        address[] storage js = _jurorList[id];
        for (uint256 i = 0; i < js.length; ++i) {
            if (_isMajority(_jurors[id][js[i]], upholdWins)) {
                c0.adjustScore(js[i], c.targetId, Rules.XP_JUROR_MAJORITY, ScoreReason.JUROR_MAJORITY);
            }
        }
    }

    function _isMajority(JurorView storage j, bool upholdWins) internal view returns (bool) {
        return j.revealed && j.uphold == upholdWins;
    }

    function _majorityCount(uint256 id, bool upholdWins) internal view returns (uint256 n) {
        address[] storage js = _jurorList[id];
        for (uint256 i = 0; i < js.length; ++i) {
            if (_isMajority(_jurors[id][js[i]], upholdWins)) ++n;
        }
    }

    /// What this challenge's escrow holds: the challenger's stake, every juror stake, and the
    /// bond slashed into it.
    function _escrowTotal(ChallengeView storage c, uint256 slashed) internal view returns (uint256) {
        return Constants.CHALLENGE_STAKE + Constants.JURY_STAKE * c.commits + slashed;
    }

    function _addRevealedStakes(Payout memory p, uint256 id) internal view {
        address[] storage js = _jurorList[id];
        for (uint256 i = 0; i < js.length; ++i) {
            if (_jurors[id][js[i]].revealed) _add(p, js[i], Constants.JURY_STAKE);
        }
    }

    function _newPayout(uint256 id) internal view returns (Payout memory p) {
        uint256 size = _jurorList[id].length + 2;
        p.to = new address[](size);
        p.amounts = new uint256[](size);
    }

    function _add(Payout memory p, address account, uint256 amount) internal pure {
        if (amount == 0) return;
        p.to[p.count] = account;
        p.amounts[p.count] = amount;
        p.count += 1;
        p.sum += amount;
    }

    /// Sends the remainder to the treasury, then trims both arrays to the entries used.
    function _finish(Payout memory p, uint256 total) internal view {
        _add(p, IVault(vault).treasury(), total - p.sum);
        address[] memory to = p.to;
        uint256[] memory amounts = p.amounts;
        uint256 used = p.count;
        assembly ("memory-safe") {
            mstore(to, used)
            mstore(amounts, used)
        }
    }
}
