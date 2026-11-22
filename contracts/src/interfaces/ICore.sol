// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFirewall} from "./IFirewall.sol";
import {
    AttestationView,
    BindMethod,
    ChallengeOutcome,
    GuardianView,
    PublisherRole,
    ScoreReason,
    TargetType,
    TargetView,
    TrustTier,
    Verdict
} from "./Types.sol";

/// Target registry, publisher binding, attestations, Guardian scores and IFirewall. Holds no funds.
interface ICore is IFirewall {
    event ModulesSet(address court, address vault);
    event TargetCreated(bytes32 indexed targetId, TargetType targetType, bytes32 target, bytes32 pinnedCodehash);
    event GuardianCreated(address indexed guardian, uint64 createdAtBlock);
    /// `weight` is frozen at this moment. `index` counts every attestation on the target from 0;
    /// `safeOrdinal` counts SAFE attestations from 1 and is 0 for other verdicts.
    event Attested(
        bytes32 indexed targetId,
        address indexed guardian,
        Verdict verdict,
        uint32 flags,
        uint8 weight,
        uint32 index,
        uint32 safeOrdinal,
        bytes32 evidenceHash,
        bytes shortProof,
        string evidenceURI
    );
    event PublisherBound(bytes32 indexed targetId, address indexed publisher, PublisherRole role, BindMethod method);
    event DelegatecallFlagged(bytes32 indexed targetId, address indexed caller);
    event AttestationSettled(bytes32 indexed targetId, uint32 index, int32 delta);
    event ScoreChanged(
        address indexed guardian, bytes32 indexed targetId, int32 delta, int32 newScore, ScoreReason reason
    );
    event DisputeMarked(bytes32 indexed targetId, uint256 indexed challengeId);
    event VerdictApplied(
        bytes32 indexed targetId, uint256 indexed challengeId, ChallengeOutcome outcome, uint32 flags
    );

    error NotAgentIdHolder();
    error DailyLimitReached(uint64 resetsAt);
    error AlreadyAttested();
    error InvalidFlags();
    error ShortProofTooLong();
    error TargetHasNoCode();
    error TargetNotFound();
    error CodeChangedSincePin();
    error SafeNotAllowedOnConfirmedDanger();
    error OnlyDeployer();
    error ModulesAlreadySet();
    error ModuleMismatch();
    error OnlyCourt();
    error SignatureExpired();
    error InvalidSignature();
    error TargetHasOwner();
    error DeployerMismatch();
    error AlreadyVerifiedPublisher();
    error PublisherAlreadyBound();
    error NothingToSettle();

    function agentId() external view returns (address);
    function deployer() external view returns (address);
    function court() external view returns (address);
    function vault() external view returns (address);

    /// One-shot. Validates both modules point back at this Core and ends the deployer's authority.
    function setModules(address court_, address vault_) external;

    function attest(
        TargetType targetType,
        bytes32 target,
        Verdict verdict,
        uint32 flags,
        bytes32 evidenceHash,
        bytes calldata shortProof,
        string calldata evidenceURI
    ) external returns (bytes32 targetId);
    /// `sig` is over BindByOwner with the current `bindNonce(target)`; see BindTypes.
    function bindByOwner(address target, address agentIdHolder, uint256 deadline, bytes calldata sig) external;
    /// `deployNonce` is the CREATE nonce that makes `deployer_` the creator of `target`.
    /// `sig` is over BindByDeployer with the current `bindNonce(target)`.
    function bindByDeployer(
        address target,
        address deployer_,
        uint256 deployNonce,
        address agentIdHolder,
        uint256 deadline,
        bytes calldata sig
    ) external;
    function bindSkill(bytes32 contentHash) external returns (bytes32 targetId);
    function sponsor(bytes32 targetId) external;
    function probeBytecode(address target) external;
    /// Pays XP for attestations in [start, start + count) that are ready: a SAFE vote 48 hours
    /// after it was cast, a DANGER vote once the target is confirmed dangerous. A CAUTION vote, and
    /// a SAFE vote on a confirmed danger, earn nothing and are skipped. Each attestation settles once.
    function settle(bytes32 targetId, uint32 start, uint32 count) external;
    /// Charges -15 to SAFE votes in the range once the target is confirmed dangerous. Tracked
    /// separately from `settle`, so the penalty is charged exactly once.
    function applyPenalties(bytes32 targetId, uint32 start, uint32 count) external;

    // Court only.
    function markDisputed(bytes32 targetId, uint256 challengeId) external;
    function applyVerdict(bytes32 targetId, uint256 challengeId, ChallengeOutcome outcome, uint32 flags) external;
    function adjustScore(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) external;

    function targetIdOfContract(address target) external pure returns (bytes32);
    function targetIdOfSkill(bytes32 canonicalBundleHash) external pure returns (bytes32);
    function canonicalBundleHashOf(bytes32 contentHash, address publisher) external pure returns (bytes32);
    function getTarget(bytes32 targetId) external view returns (TargetView memory);
    function tierOf(bytes32 targetId) external view returns (TrustTier);
    /// Reverts when `index` is out of range; an empty struct would read as a SAFE vote.
    function getAttestation(bytes32 targetId, uint32 index) external view returns (AttestationView memory);
    function attestationIndexOf(bytes32 targetId, address guardian)
        external
        view
        returns (bool attested, uint32 index);
    function getGuardian(address guardian) external view returns (GuardianView memory);
    function weightOf(address guardian) external view returns (uint8);
    function attestationsLeftToday(address guardian) external view returns (uint8);
    function isAgentIdHolder(address account) external view returns (bool);
    /// Per-target counter every binding consumes. Part of the signed binding message.
    function bindNonce(address target) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    /// Number of attestations `settle` would pay if called now over the whole target.
    function pendingSettlement(bytes32 targetId) external view returns (uint32);
    /// Number of SAFE votes `applyPenalties` would still charge.
    function pendingPenalties(bytes32 targetId) external view returns (uint32);
}
