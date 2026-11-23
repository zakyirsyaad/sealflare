// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentID} from "./interfaces/IAgentID.sol";
import {ICore} from "./interfaces/ICore.sol";
import {AttestationView, GuardianView, ScoreReason, TargetType, TargetView} from "./interfaces/Types.sol";

/// Core's storage and the helpers both halves of Core share. Core is split across CoreBase,
/// CoreSettlement and Core only to keep each file readable; it deploys as one contract.
abstract contract CoreBase is ICore {
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
    /// Attestation count when the target was confirmed dangerous. Only DANGER votes below this
    /// index were cast before the verdict and can earn XP for it (architecture 4.6, D21).
    mapping(bytes32 => uint32) internal _countAtVerdict;

    constructor(address agentId_) {
        agentId = agentId_;
        deployer = msg.sender;
    }

    function isAgentIdHolder(address account) public view returns (bool) {
        return IAgentID(agentId).balanceOf(account) > 0;
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

    function _changeScore(address guardian, bytes32 targetId, int32 delta, ScoreReason reason) internal {
        GuardianView storage g = _guardians[guardian];
        int32 next = g.score + delta;
        g.score = next;
        emit ScoreChanged(guardian, targetId, delta, next, reason);
    }
}
