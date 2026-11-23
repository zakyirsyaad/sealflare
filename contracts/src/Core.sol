// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {CoreBase} from "./CoreBase.sol";
import {CoreSettlement} from "./CoreSettlement.sol";
import {IVault} from "./interfaces/IVault.sol";
import {BytecodeScan} from "./lib/BytecodeScan.sol";
import {
    AttestationView,
    BindMethod,
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
import {BindTypes} from "./lib/BindTypes.sol";
import {Constants} from "./lib/Constants.sol";
import {CreateAddress} from "./lib/CreateAddress.sol";
import {Ids} from "./lib/Ids.sol";
import {OwnerRead} from "./lib/OwnerRead.sol";
import {Rules} from "./lib/Rules.sol";

/// Target registry, attestations, publisher binding and IFirewall. Holds no funds. Storage lives in
/// CoreBase; module wiring, XP settlement and the Court-only entry points in CoreSettlement.
contract Core is CoreSettlement {
    constructor(address agentId_) CoreBase(agentId_) {}

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
            targetId,
            msg.sender,
            verdict,
            flags,
            v.weight,
            v.index,
            v.safeOrdinal,
            evidenceHash,
            shortProof,
            evidenceURI
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

    function attestationIndexOf(bytes32 targetId, address guardian)
        external
        view
        returns (bool attested, uint32 index)
    {
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

    // ---- publisher binding ----------------------------------------------------------------------

    function bindByOwner(address target, address agentIdHolder, uint256 deadline, bytes calldata sig) external {
        _checkBindRequest(agentIdHolder, deadline);
        address owner = OwnerRead.ownerOf(target);
        if (owner == address(0)) revert InvalidSignature();
        _consumeSignature(
            owner, target, BindTypes.hashBindByOwner(target, agentIdHolder, bindNonce[target], deadline), sig
        );
        _bind(_contractTarget(target), agentIdHolder, PublisherRole.VERIFIED_PUBLISHER, BindMethod.OWNER);
    }

    /// The signature is checked before the publisher state, so a replayed signature fails as
    /// InvalidSignature and a fresh one on an already verified target as AlreadyVerifiedPublisher (D5).
    function bindByDeployer(
        address target,
        address deployer_,
        uint256 deployNonce,
        address agentIdHolder,
        uint256 deadline,
        bytes calldata sig
    ) external {
        _checkBindRequest(agentIdHolder, deadline);
        if (OwnerRead.ownerOf(target) != address(0)) revert TargetHasOwner();
        if (deployer_ == address(0) || CreateAddress.compute(deployer_, deployNonce) != target) {
            revert DeployerMismatch();
        }
        bytes32 structHash =
            BindTypes.hashBindByDeployer(target, deployer_, deployNonce, agentIdHolder, bindNonce[target], deadline);
        _consumeSignature(deployer_, target, structHash, sig);
        bytes32 targetId = _contractTarget(target);
        if (_targets[targetId].publisherRole == PublisherRole.VERIFIED_PUBLISHER) revert AlreadyVerifiedPublisher();
        _bind(targetId, agentIdHolder, PublisherRole.VERIFIED_PUBLISHER, BindMethod.DEPLOYER);
    }

    /// The sender is part of the canonical hash, so a claim on someone else's bundle lands on a
    /// target id the scanner never produces for that bundle.
    function bindSkill(bytes32 contentHash) external returns (bytes32 targetId) {
        if (!isAgentIdHolder(msg.sender)) revert NotAgentIdHolder();
        bytes32 canonical = Ids.canonicalBundleHashOf(contentHash, msg.sender);
        targetId = Ids.targetIdOfSkill(canonical);
        _createTargetIfNew(TargetType.AI_SKILL_BUNDLE, canonical, targetId);
        if (_targets[targetId].publisherRole == PublisherRole.VERIFIED_PUBLISHER) revert AlreadyVerifiedPublisher();
        _bind(targetId, msg.sender, PublisherRole.VERIFIED_PUBLISHER, BindMethod.SKILL);
    }

    function sponsor(bytes32 targetId) external {
        if (!isAgentIdHolder(msg.sender)) revert NotAgentIdHolder();
        if (!_exists[targetId]) revert TargetNotFound();
        if (_targets[targetId].publisherRole != PublisherRole.NONE) revert PublisherAlreadyBound();
        _bind(targetId, msg.sender, PublisherRole.THIRD_PARTY_SPONSOR, BindMethod.SPONSOR);
    }

    /// Computed per call so a chain fork with a new chain id cannot reuse old signatures.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return BindTypes.domainSeparator(block.chainid, address(this));
    }

    function _checkBindRequest(address agentIdHolder, uint256 deadline) internal view {
        if (!isAgentIdHolder(agentIdHolder)) revert NotAgentIdHolder();
        if (block.timestamp > deadline) revert SignatureExpired();
    }

    /// Checks an EOA or ERC-1271 signature over the EIP-712 digest, then spends the target's nonce.
    function _consumeSignature(address signer, address target, bytes32 structHash, bytes calldata sig) internal {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        if (!SignatureChecker.isValidSignatureNow(signer, digest, sig)) revert InvalidSignature();
        bindNonce[target] += 1;
    }

    /// Registers a contract target with code on first binding, as attest would.
    function _contractTarget(address target) internal returns (bytes32 targetId) {
        if (target.code.length == 0) revert TargetHasNoCode();
        targetId = Ids.targetIdOfContract(target);
        _createTargetIfNew(TargetType.SMART_CONTRACT, bytes32(uint256(uint160(target))), targetId);
    }

    function _bind(bytes32 targetId, address publisher, PublisherRole role, BindMethod method) internal {
        TargetView storage t = _targets[targetId];
        t.publisher = publisher;
        t.publisherRole = role;
        emit PublisherBound(targetId, publisher, role, method);
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
}
