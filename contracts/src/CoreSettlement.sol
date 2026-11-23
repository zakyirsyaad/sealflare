// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CoreBase} from "./CoreBase.sol";
import {ICourt} from "./interfaces/ICourt.sol";
import {IVault} from "./interfaces/IVault.sol";
import {AttestationView, ChallengeOutcome, ScoreReason, TargetView, Verdict} from "./interfaces/Types.sol";
import {Constants} from "./lib/Constants.sol";
import {Rules} from "./lib/Rules.sol";

/// Module wiring, XP settlement and the three entry points only Court may call.
abstract contract CoreSettlement is CoreBase {
    modifier onlyCourt() {
        if (court == address(0) || msg.sender != court) revert OnlyCourt();
        _;
    }

    // ---- module wiring --------------------------------------------------------------------------

    /// One-shot: once `court` is set the deployer has no authority left. A module without code,
    /// or one that points at another Core or another Vault, is rejected as a mismatch.
    function setModules(address court_, address vault_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (court != address(0)) revert ModulesAlreadySet();
        if (court_.code.length == 0 || vault_.code.length == 0) revert ModuleMismatch();
        if (
            ICourt(court_).core() != address(this) || IVault(vault_).core() != address(this)
                || ICourt(court_).vault() != vault_
        ) revert ModuleMismatch();
        court = court_;
        vault = vault_;
        emit ModulesSet(court_, vault_);
    }

    // ---- Court only ---------------------------------------------------------------------------

    function markDisputed(bytes32 targetId, uint256 challengeId) external onlyCourt {
        if (!_exists[targetId]) revert TargetNotFound();
        _targets[targetId].activeChallengeId = challengeId;
        emit DisputeMarked(targetId, challengeId);
    }

    /// Closes the dispute `markDisputed` opened. Any other challenge id is rejected as
    /// NothingToSettle, so a stale or mistaken verdict can never confirm danger (D14).
    function applyVerdict(bytes32 targetId, uint256 challengeId, ChallengeOutcome outcome, uint32 flags)
        external
        onlyCourt
    {
        TargetView storage t = _targets[targetId];
        if (challengeId == 0 || t.activeChallengeId != challengeId) revert NothingToSettle();
        t.activeChallengeId = 0;
        if (outcome == ChallengeOutcome.UPHELD) {
            t.confirmedDanger = true;
            t.activeFlags |= flags;
        }
        emit VerdictApplied(targetId, challengeId, outcome, flags);
    }

    /// Jurors and challengers may never have attested, so their profile is created here.
    function adjustScore(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) external onlyCourt {
        _ensureGuardian(guardian);
        _changeScore(guardian, targetId, delta, reason);
    }

    // ---- XP settlement ------------------------------------------------------------------------

    function settle(bytes32 targetId, uint32 start, uint32 count) external {
        AttestationView[] storage list = _attestations[targetId];
        TargetView storage t = _targets[targetId];
        uint256 end = _rangeEnd(list.length, start, count);
        for (uint256 i = start; i < end; ++i) {
            AttestationView storage a = list[i];
            (bool ready, int32 delta, ScoreReason reason) = _settlementOf(a, t);
            if (!ready) continue;
            a.settled = true;
            emit AttestationSettled(targetId, uint32(i), delta);
            if (delta != 0) _changeScore(a.guardian, targetId, delta, reason);
        }
    }

    function applyPenalties(bytes32 targetId, uint32 start, uint32 count) external {
        if (!_targets[targetId].confirmedDanger) revert NothingToSettle();
        AttestationView[] storage list = _attestations[targetId];
        uint256 end = _rangeEnd(list.length, start, count);
        for (uint256 i = start; i < end; ++i) {
            AttestationView storage a = list[i];
            if (!_penaltyDue(a)) continue;
            a.penalized = true;
            int32 delta = Rules.attestationPenalty(a.verdict, true);
            _changeScore(a.guardian, targetId, delta, ScoreReason.SAFE_ON_DANGER);
        }
    }

    function pendingSettlement(bytes32 targetId) external view returns (uint32 pending) {
        AttestationView[] storage list = _attestations[targetId];
        TargetView storage t = _targets[targetId];
        for (uint256 i = 0; i < list.length; ++i) {
            (bool ready,,) = _settlementOf(list[i], t);
            if (ready) ++pending;
        }
    }

    function pendingPenalties(bytes32 targetId) external view returns (uint32 pending) {
        if (!_targets[targetId].confirmedDanger) return 0;
        AttestationView[] storage list = _attestations[targetId];
        for (uint256 i = 0; i < list.length; ++i) {
            if (_penaltyDue(list[i])) ++pending;
        }
    }

    /// Whether `settle` would settle this attestation now, and for how much (architecture 4.6).
    /// A SAFE vote waits out its 48 hours, any open dispute, and is never paid on a confirmed
    /// danger; a DANGER vote waits for the danger verdict; CAUTION never settles.
    function _settlementOf(AttestationView storage a, TargetView storage t)
        internal
        view
        returns (bool ready, int32 delta, ScoreReason reason)
    {
        if (a.settled || a.verdict == Verdict.CAUTION) return (false, 0, reason);
        if (a.verdict == Verdict.DANGER) {
            if (!t.confirmedDanger) return (false, 0, reason);
            return (true, Rules.attestationXp(Verdict.DANGER, 0, true, true), ScoreReason.DANGER_CONFIRMED);
        }
        if (t.confirmedDanger || t.activeChallengeId != 0) return (false, 0, reason);
        if (block.timestamp < uint256(a.timestamp) + Constants.SETTLE_DELAY) return (false, 0, reason);
        delta = Rules.attestationXp(Verdict.SAFE, a.safeOrdinal, !a.castDuringDispute, false);
        reason = a.safeOrdinal <= Rules.EARLY_SAFE_SLOTS ? ScoreReason.EARLY_SAFE : ScoreReason.CONFIRMING_SAFE;
        return (true, delta, reason);
    }

    function _penaltyDue(AttestationView storage a) internal view returns (bool) {
        return a.verdict == Verdict.SAFE && !a.penalized;
    }

    /// End of [start, start + count) clamped to the list, computed wide so it cannot overflow.
    function _rangeEnd(uint256 length, uint32 start, uint32 count) internal pure returns (uint256) {
        uint256 end = uint256(start) + count;
        return end < length ? end : length;
    }
}
