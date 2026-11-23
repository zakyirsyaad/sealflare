// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentID} from "./interfaces/IAgentID.sol";
import {ICore} from "./interfaces/ICore.sol";
import {IVault} from "./interfaces/IVault.sol";
import {BytecodeScan} from "./lib/BytecodeScan.sol";
import {
    AttestationView,
    ChallengeOutcome,
    GuardianView,
    PublisherRole,
    TierInput,
    ScoreReason,
    TargetType,
    TargetView,
    TrustTier,
    Verdict
} from "./interfaces/Types.sol";
import {Constants} from "./lib/Constants.sol";
import {Ids} from "./lib/Ids.sol";
import {Rules} from "./lib/Rules.sol";

/// Target registry and attestations. Holds no funds.
///
/// Tasks 1 and 2 implement attestations, tier, firewall views and bytecode probing.
/// Every other interface function carries a temporary `revert("not implemented")` body so the contract compiles; later tasks
/// replace them and none may remain after Task 4. `court`, `vault` and `bindNonce` are passive
/// storage getters that read zero until their tasks wire them.
contract Core is ICore {
    address public immutable agentId;
    address public immutable deployer;
    address public court;
    address public vault;

    mapping(bytes32 => TargetView) internal _targets;
    mapping(bytes32 => bool) internal _exists;
    mapping(bytes32 => AttestationView[]) internal _attestations;
    mapping(bytes32 => mapping(address => uint32)) internal _indexPlusOne;
    mapping(address => GuardianView) internal _guardians;
    mapping(address => uint256) public bindNonce;

    constructor(address agentId_) {
        agentId = agentId_;
        deployer = msg.sender;
    }

    // ---- writes -------------------------------------------------------------------------------

    function attest(
        TargetType targetType,
        bytes32 target,
        Verdict verdict,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external returns (bytes32 targetId) {
        if (!isAgentIdHolder(msg.sender)) revert NotAgentIdHolder();
        if (!Rules.isValidFlags(targetType, verdict, flags)) revert InvalidFlags();
        if (shortProof.length > Constants.SHORT_PROOF_MAX_BYTES) revert ShortProofTooLong();
        targetId = _checkedTargetId(targetType, target);
        if (_indexPlusOne[targetId][msg.sender] != 0) revert AlreadyAttested();
        _checkDailyQuota(_guardians[msg.sender]);
        if (verdict == Verdict.SAFE && _targets[targetId].confirmedDanger) {
            revert SafeNotAllowedOnConfirmedDanger();
        }
        _createTargetIfNew(targetType, target, targetId);
        GuardianView storage g = _ensureGuardian(msg.sender);
        Vote memory v = _recordVote(targetId, verdict, flags, g);
        emit Attested(
            targetId, msg.sender, verdict, flags, v.weight, v.index, v.safeOrdinal, evidenceHash, shortProof, evidenceURI
        );
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

    /// An out-of-range index panics (0x32) rather than returning an empty struct, which would read
    /// as a SAFE vote.
    function getAttestation(bytes32 targetId, uint32 index) external view returns (AttestationView memory) {
        return _attestations[targetId][index];
    }

    function attestationIndexOf(bytes32 targetId, address guardian) external view returns (bool attested, uint32 index) {
        uint32 plusOne = _indexPlusOne[targetId][guardian];
        return plusOne == 0 ? (false, 0) : (true, plusOne - 1);
    }

    function getGuardian(address guardian) external view returns (GuardianView memory) {
        return _guardians[guardian];
    }

    function weightOf(address guardian) external view returns (uint8) {
        return Rules.weightOf(_guardians[guardian].score);
    }

    function attestationsLeftToday(address guardian) external view returns (uint8) {
        GuardianView storage g = _guardians[guardian];
        uint64 today = uint64(block.timestamp / 1 days);
        uint8 used = g.lastAttestDay == today ? g.attestsToday : 0;
        return Constants.DAILY_ATTEST_LIMIT - used;
    }

    function isAgentIdHolder(address account) public view returns (bool) {
        return IAgentID(agentId).balanceOf(account) > 0;
    }

    // ---- bytecode probe and firewall -----------------------------------------------------------

    function probeBytecode(address target) external {
        bytes memory code = target.code;
        if (code.length == 0) revert TargetHasNoCode();
        bytes32 targetId = Ids.targetIdOfContract(target);
        _createTargetIfNew(TargetType.SMART_CONTRACT, bytes32(uint256(uint160(target))), targetId);
        TargetView storage t = _targets[targetId];
        if (!t.hasDelegatecall && BytecodeScan.hasDelegatecall(code)) {
            t.hasDelegatecall = true;
            emit DelegatecallFlagged(targetId, msg.sender);
        }
    }

    function tierOf(bytes32 targetId) external view returns (TrustTier) {
        TargetView storage t = _targets[targetId];
        return _tierOf(targetId, t, _verifiedPublisherBond(targetId, t));
    }

    function verifyContract(address target)
        external
        view
        returns (
            TrustTier tier,
            bool isUpgradeableProxy,
            bytes32 pinnedCodehash,
            uint32 activeFlags,
            uint256 warrantyBondActive
        )
    {
        bytes32 targetId = Ids.targetIdOfContract(target);
        TargetView storage t = _targets[targetId];
        warrantyBondActive = _verifiedPublisherBond(targetId, t);
        return (
            _tierOf(targetId, t, warrantyBondActive),
            t.hasDelegatecall,
            t.pinnedCodehash,
            t.activeFlags,
            warrantyBondActive
        );
    }

    function verifySkillBundle(bytes32 canonicalBundleHash)
        external
        view
        returns (TrustTier tier, address publisher, uint32 activeFlags, uint256 warrantyBondActive)
    {
        bytes32 targetId = Ids.targetIdOfSkill(canonicalBundleHash);
        TargetView storage t = _targets[targetId];
        warrantyBondActive = _verifiedPublisherBond(targetId, t);
        publisher = t.publisherRole == PublisherRole.VERIFIED_PUBLISHER ? t.publisher : address(0);
        return (_tierOf(targetId, t, warrantyBondActive), publisher, t.activeFlags, warrantyBondActive);
    }

    function _verifiedPublisherBond(bytes32 targetId, TargetView storage t) internal view returns (uint256) {
        if (t.publisherRole != PublisherRole.VERIFIED_PUBLISHER || vault == address(0)) return 0;
        return IVault(vault).activeBond(targetId);
    }

    function _tierOf(bytes32 targetId, TargetView storage t, uint256 bond) internal view returns (TrustTier) {
        bool drift = _exists[targetId] && t.targetType == TargetType.SMART_CONTRACT
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
                verifiedPublisherBond: bond > 0
            })
        );
    }

    // ---- attest internals ---------------------------------------------------------------------

    struct Vote {
        uint8 weight;
        uint32 index;
        uint32 safeOrdinal;
    }

    /// Resolves the target id and, for a contract, checks the word is a clean address with code and
    /// that its code has not drifted from the pin. Skills pin nothing.
    function _checkedTargetId(TargetType targetType, bytes32 target) internal view returns (bytes32 targetId) {
        if (targetType == TargetType.AI_SKILL_BUNDLE) {
            return Ids.targetIdOfSkill(target);
        }
        if (uint256(target) >> 160 != 0) revert TargetHasNoCode();
        address addr = address(uint160(uint256(target)));
        if (addr.code.length == 0) revert TargetHasNoCode();
        targetId = Ids.targetIdOfContract(addr);
        if (_exists[targetId] && _targets[targetId].pinnedCodehash != addr.codehash) {
            revert CodeChangedSincePin();
        }
    }

    function _createTargetIfNew(TargetType targetType, bytes32 target, bytes32 targetId) internal {
        if (_exists[targetId]) return;
        bytes32 pinned =
            targetType == TargetType.SMART_CONTRACT ? address(uint160(uint256(target))).codehash : bytes32(0);
        TargetView storage t = _targets[targetId];
        t.targetType = targetType;
        t.target = target;
        t.pinnedCodehash = pinned;
        t.createdAt = uint64(block.timestamp);
        _exists[targetId] = true;
        emit TargetCreated(targetId, targetType, target, pinned);
    }

    function _ensureGuardian(address account) internal returns (GuardianView storage g) {
        g = _guardians[account];
        if (!g.exists) {
            g.exists = true;
            g.createdAtBlock = uint64(block.number);
            emit GuardianCreated(account, uint64(block.number));
        }
    }

    function _checkDailyQuota(GuardianView storage g) internal view {
        uint64 today = uint64(block.timestamp / 1 days);
        uint8 used = g.lastAttestDay == today ? g.attestsToday : 0;
        if (used >= Constants.DAILY_ATTEST_LIMIT) {
            revert DailyLimitReached(uint64((block.timestamp / 1 days + 1) * 1 days));
        }
    }

    function _recordVote(bytes32 targetId, Verdict verdict, uint32 flags, GuardianView storage g)
        internal
        returns (Vote memory v)
    {
        TargetView storage t = _targets[targetId];
        v.weight = Rules.weightOf(g.score);
        v.index = t.attestationCount;
        if (verdict == Verdict.SAFE) {
            t.safeCount += 1;
            v.safeOrdinal = t.safeCount;
            t.safeWeight += v.weight;
        } else if (verdict == Verdict.CAUTION) {
            t.cautionWeight += v.weight;
        } else {
            t.dangerWeight += v.weight;
        }
        t.activeFlags |= flags;
        t.attestationCount = v.index + 1;
        g.attestationCount += 1;
        uint64 today = uint64(block.timestamp / 1 days);
        if (g.lastAttestDay != today) {
            g.lastAttestDay = today;
            g.attestsToday = 0;
        }
        g.attestsToday += 1;
        _attestations[targetId].push(
            AttestationView(
                msg.sender,
                verdict,
                flags,
                v.weight,
                v.safeOrdinal,
                uint64(block.timestamp),
                false,
                false,
                t.activeChallengeId != 0
            )
        );
        _indexPlusOne[targetId][msg.sender] = v.index + 1;
    }

    // ---- not implemented yet (temporary bodies, removed by Task 4) ----------------------------

    function setModules(address, address) external {
        revert("not implemented");
    }

    function bindByOwner(address, address, uint256, bytes calldata) external {
        revert("not implemented");
    }

    function bindByDeployer(address, address, uint256, address, uint256, bytes calldata) external {
        revert("not implemented");
    }

    function bindSkill(bytes32) external returns (bytes32) {
        revert("not implemented");
    }

    function sponsor(bytes32) external {
        revert("not implemented");
    }

    function settle(bytes32, uint32, uint32) external {
        revert("not implemented");
    }

    function applyPenalties(bytes32, uint32, uint32) external {
        revert("not implemented");
    }

    function markDisputed(bytes32, uint256) external {
        revert("not implemented");
    }

    function applyVerdict(bytes32, uint256, ChallengeOutcome, uint32) external {
        revert("not implemented");
    }

    function adjustScore(address, bytes32, int32, ScoreReason) external {
        revert("not implemented");
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        revert("not implemented");
    }

    function pendingSettlement(bytes32) external view returns (uint32) {
        revert("not implemented");
    }

    function pendingPenalties(bytes32) external view returns (uint32) {
        revert("not implemented");
    }
}
