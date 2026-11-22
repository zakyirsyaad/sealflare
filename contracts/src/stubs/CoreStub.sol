// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentID} from "../interfaces/IAgentID.sol";
import {ICore} from "../interfaces/ICore.sol";
import {IVault} from "../interfaces/IVault.sol";
import {
    AttestationView,
    BindMethod,
    ChallengeOutcome,
    GuardianView,
    PublisherRole,
    ScoreReason,
    TargetType,
    TargetView,
    TierInput,
    TrustTier,
    Verdict
} from "../interfaces/Types.sol";
import {Constants} from "../lib/Constants.sol";
import {Ids} from "../lib/Ids.sol";
import {Rules} from "../lib/Rules.sol";

/// @dev Local development only. Never deploy to a public network.
/// Emits the final Core events and keeps enough state for the views to agree with them, so the
/// web app and the indexer can be built before the real Core exists. It checks no Agent ID, no
/// quota, no signature and no caller: every `stub*` setter and every Court-only function is open.
contract CoreStub is ICore {
    address public immutable agentId;
    address public immutable deployer;
    address public court;
    address public vault;

    mapping(bytes32 => TargetView) internal _targets;
    mapping(bytes32 => bool) internal _exists;
    mapping(bytes32 => AttestationView[]) internal _attestations;
    mapping(bytes32 => mapping(address => uint256)) internal _indexPlusOne;
    mapping(address => GuardianView) internal _guardians;
    mapping(bytes32 => bool) internal _tierForced;
    mapping(bytes32 => TrustTier) internal _forcedTier;
    mapping(address => bool) internal _leftForced;
    mapping(address => uint8) internal _forcedLeft;

    constructor(address agentId_) {
        agentId = agentId_;
        deployer = msg.sender;
    }

    // ---- test setters -------------------------------------------------------------------------

    function stubSetTarget(bytes32 targetId, TargetView calldata value) external {
        _targets[targetId] = value;
        _exists[targetId] = true;
    }

    function stubSetTier(bytes32 targetId, TrustTier tier) external {
        _tierForced[targetId] = true;
        _forcedTier[targetId] = tier;
    }

    function stubSetGuardian(address guardian, GuardianView calldata value) external {
        _guardians[guardian] = value;
    }

    function stubSetAttestationsLeft(address guardian, uint8 left) external {
        _leftForced[guardian] = true;
        _forcedLeft[guardian] = left;
    }

    // ---- writes -------------------------------------------------------------------------------

    function setModules(address court_, address vault_) external {
        court = court_;
        vault = vault_;
        emit ModulesSet(court_, vault_);
    }

    function attest(
        TargetType targetType,
        bytes32 target,
        Verdict verdict,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external returns (bytes32 targetId) {
        targetId = _touch(targetType, target);
        Recorded memory r = _record(targetId, verdict, flags);
        emit Attested(
            targetId, msg.sender, verdict, flags, r.weight, r.index, r.safeOrdinal, evidenceHash, shortProof, evidenceURI
        );
    }

    struct Recorded {
        uint8 weight;
        uint32 index;
        uint32 safeOrdinal;
    }

    function _record(bytes32 targetId, Verdict verdict, uint32 flags) internal returns (Recorded memory r) {
        if (_indexPlusOne[targetId][msg.sender] != 0) revert AlreadyAttested();

        GuardianView storage g = _guardian(msg.sender);
        r.weight = Rules.weightOf(g.score);
        g.attestationCount += 1;

        TargetView storage t = _targets[targetId];
        r.index = t.attestationCount;
        if (verdict == Verdict.SAFE) {
            t.safeCount += 1;
            t.safeWeight += r.weight;
            r.safeOrdinal = t.safeCount;
        } else if (verdict == Verdict.CAUTION) {
            t.cautionWeight += r.weight;
        } else {
            t.dangerWeight += r.weight;
        }
        t.activeFlags |= flags;
        t.attestationCount = r.index + 1;

        _attestations[targetId].push(
            AttestationView(msg.sender, verdict, flags, r.weight, r.safeOrdinal, uint64(block.timestamp), false, false)
        );
        _indexPlusOne[targetId][msg.sender] = uint256(r.index) + 1;
    }

    function bindByOwner(address target, address agentIdHolder, uint256, bytes calldata) external {
        _bind(_touch(TargetType.SMART_CONTRACT, _word(target)), agentIdHolder, BindMethod.OWNER);
    }

    function bindByDeployer(address target, address, uint256, address agentIdHolder, uint256, bytes calldata)
        external
    {
        _bind(_touch(TargetType.SMART_CONTRACT, _word(target)), agentIdHolder, BindMethod.DEPLOYER);
    }

    function bindSkill(bytes32 contentHash) external returns (bytes32 targetId) {
        targetId = _touch(TargetType.AI_SKILL_BUNDLE, Ids.canonicalBundleHashOf(contentHash, msg.sender));
        _bind(targetId, msg.sender, BindMethod.SKILL);
    }

    function sponsor(bytes32 targetId) external {
        if (!_exists[targetId]) revert TargetNotFound();
        _targets[targetId].publisher = msg.sender;
        _targets[targetId].publisherRole = PublisherRole.THIRD_PARTY_SPONSOR;
        emit PublisherBound(targetId, msg.sender, PublisherRole.THIRD_PARTY_SPONSOR, BindMethod.SPONSOR);
    }

    function probeBytecode(address target) external {
        bytes32 targetId = _touch(TargetType.SMART_CONTRACT, _word(target));
        _targets[targetId].hasDelegatecall = true;
        emit DelegatecallFlagged(targetId, msg.sender);
    }

    function settle(bytes32 targetId, uint32 start, uint32 count) external {
        AttestationView[] storage list = _attestations[targetId];
        bool danger = _targets[targetId].confirmedDanger;
        for (uint32 i = start; i < start + count && i < list.length; ++i) {
            AttestationView storage a = list[i];
            if (a.settled || a.verdict == Verdict.CAUTION) continue;
            if (a.verdict == Verdict.SAFE && danger) continue;
            a.settled = true;
            int32 delta = Rules.attestationXp(a.verdict, a.safeOrdinal, true, danger);
            emit AttestationSettled(targetId, i, delta);
            _score(a.guardian, targetId, delta, _reason(a, danger));
        }
    }

    function applyPenalties(bytes32 targetId, uint32 start, uint32 count) external {
        AttestationView[] storage list = _attestations[targetId];
        if (!_targets[targetId].confirmedDanger) revert NothingToSettle();
        for (uint32 i = start; i < start + count && i < list.length; ++i) {
            AttestationView storage a = list[i];
            if (a.verdict != Verdict.SAFE || a.penalized) continue;
            a.penalized = true;
            _score(a.guardian, targetId, Rules.XP_SAFE_ON_DANGER, ScoreReason.SAFE_ON_DANGER);
        }
    }

    function markDisputed(bytes32 targetId, uint256 challengeId) external {
        _targets[targetId].activeChallengeId = challengeId;
        emit DisputeMarked(targetId, challengeId);
    }

    function applyVerdict(bytes32 targetId, uint256 challengeId, ChallengeOutcome outcome, uint32 flags) external {
        TargetView storage t = _targets[targetId];
        t.activeChallengeId = 0;
        if (outcome == ChallengeOutcome.UPHELD) {
            t.confirmedDanger = true;
            t.activeFlags |= flags;
        }
        emit VerdictApplied(targetId, challengeId, outcome, flags);
    }

    function adjustScore(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) external {
        _guardian(guardian);
        _score(guardian, targetId, delta, reason);
    }

    // ---- views --------------------------------------------------------------------------------

    function targetIdOfContract(address target) external pure returns (bytes32) {
        return Ids.targetIdOfContract(target);
    }

    function targetIdOfSkill(bytes32 canonicalBundleHash) external pure returns (bytes32) {
        return Ids.targetIdOfSkill(canonicalBundleHash);
    }

    function canonicalBundleHashOf(bytes32 contentHash, address publisher) external pure returns (bytes32) {
        return Ids.canonicalBundleHashOf(contentHash, publisher);
    }

    function getTarget(bytes32 targetId) external view returns (TargetView memory) {
        return _targets[targetId];
    }

    function tierOf(bytes32 targetId) public view returns (TrustTier) {
        if (_tierForced[targetId]) return _forcedTier[targetId];
        TargetView storage t = _targets[targetId];
        bool drift = t.targetType == TargetType.SMART_CONTRACT && _exists[targetId]
            && address(uint160(uint256(t.target))).codehash != t.pinnedCodehash;
        return Rules.tierOf(
            TierInput({
                confirmedDanger: t.confirmedDanger,
                codehashDrift: drift,
                activeDispute: t.activeChallengeId != 0,
                safeWeight: t.safeWeight,
                cautionWeight: t.cautionWeight,
                dangerWeight: t.dangerWeight,
                proxyMarker: t.hasDelegatecall,
                verifiedPublisherBond: t.publisherRole == PublisherRole.VERIFIED_PUBLISHER && _bond(targetId) > 0
            })
        );
    }

    function getAttestation(bytes32 targetId, uint32 index) external view returns (AttestationView memory) {
        return _attestations[targetId][index];
    }

    function attestationIndexOf(bytes32 targetId, address guardian) external view returns (bool, uint32) {
        uint256 plusOne = _indexPlusOne[targetId][guardian];
        return plusOne == 0 ? (false, 0) : (true, uint32(plusOne - 1));
    }

    function getGuardian(address guardian) external view returns (GuardianView memory) {
        return _guardians[guardian];
    }

    function weightOf(address guardian) external view returns (uint8) {
        return Rules.weightOf(_guardians[guardian].score);
    }

    function attestationsLeftToday(address guardian) external view returns (uint8) {
        return _leftForced[guardian] ? _forcedLeft[guardian] : Constants.DAILY_ATTEST_LIMIT;
    }

    function isAgentIdHolder(address account) external view returns (bool) {
        return IAgentID(agentId).balanceOf(account) > 0;
    }

    function pendingSettlement(bytes32 targetId) external view returns (uint32 n) {
        AttestationView[] storage list = _attestations[targetId];
        for (uint256 i; i < list.length; ++i) {
            if (!list[i].settled && list[i].verdict != Verdict.CAUTION) ++n;
        }
    }

    function pendingPenalties(bytes32 targetId) external view returns (uint32 n) {
        if (!_targets[targetId].confirmedDanger) return 0;
        AttestationView[] storage list = _attestations[targetId];
        for (uint256 i; i < list.length; ++i) {
            if (list[i].verdict == Verdict.SAFE && !list[i].penalized) ++n;
        }
    }

    function verifyContract(address target) external view returns (TrustTier, bool, bytes32, uint32, uint256) {
        bytes32 targetId = Ids.targetIdOfContract(target);
        TargetView storage t = _targets[targetId];
        return (tierOf(targetId), t.hasDelegatecall, t.pinnedCodehash, t.activeFlags, _bond(targetId));
    }

    function verifySkillBundle(bytes32 canonicalBundleHash) external view returns (TrustTier, address, uint32, uint256) {
        bytes32 targetId = Ids.targetIdOfSkill(canonicalBundleHash);
        TargetView storage t = _targets[targetId];
        return (tierOf(targetId), t.publisher, t.activeFlags, _bond(targetId));
    }

    // ---- internals ----------------------------------------------------------------------------

    function _word(address target) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(target)));
    }

    function _touch(TargetType targetType, bytes32 target) internal returns (bytes32 targetId) {
        bool isContract = targetType == TargetType.SMART_CONTRACT;
        targetId = isContract ? Ids.targetIdOfContract(address(uint160(uint256(target)))) : Ids.targetIdOfSkill(target);
        if (_exists[targetId]) return targetId;
        bytes32 pinned = isContract ? address(uint160(uint256(target))).codehash : bytes32(0);
        TargetView storage t = _targets[targetId];
        t.targetType = targetType;
        t.target = target;
        t.pinnedCodehash = pinned;
        t.createdAt = uint64(block.timestamp);
        _exists[targetId] = true;
        emit TargetCreated(targetId, targetType, target, pinned);
    }

    function _guardian(address account) internal returns (GuardianView storage g) {
        g = _guardians[account];
        if (g.exists) return g;
        g.exists = true;
        g.createdAtBlock = uint64(block.number);
        emit GuardianCreated(account, uint64(block.number));
    }

    function _bind(bytes32 targetId, address publisher, BindMethod method) internal {
        _targets[targetId].publisher = publisher;
        _targets[targetId].publisherRole = PublisherRole.VERIFIED_PUBLISHER;
        emit PublisherBound(targetId, publisher, PublisherRole.VERIFIED_PUBLISHER, method);
    }

    function _score(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) internal {
        if (delta == 0) return;
        GuardianView storage g = _guardians[guardian];
        g.score += delta;
        emit ScoreChanged(guardian, targetId, delta, g.score, reason);
    }

    function _reason(AttestationView storage a, bool danger) internal view returns (ScoreReason) {
        if (a.verdict == Verdict.DANGER && danger) return ScoreReason.DANGER_CONFIRMED;
        return a.safeOrdinal <= Rules.EARLY_SAFE_SLOTS ? ScoreReason.EARLY_SAFE : ScoreReason.CONFIRMING_SAFE;
    }

    function _bond(bytes32 targetId) internal view returns (uint256) {
        return vault == address(0) ? 0 : IVault(vault).activeBond(targetId);
    }
}
