// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TargetType} from "../interfaces/Types.sol";

/// Target identity. Mirrors shared/rules/ids.ts; both are checked against shared/rules/vectors/ids.json.
library Ids {
    function targetIdOfContract(address target) internal pure returns (bytes32) {
        return keccak256(abi.encode(TargetType.SMART_CONTRACT, target));
    }

    function targetIdOfSkill(bytes32 canonicalBundleHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(TargetType.AI_SKILL_BUNDLE, canonicalBundleHash));
    }

    /// The publisher address is an input, so a claim on someone else's bundle lands on a hash no scanner produces.
    function canonicalBundleHashOf(bytes32 contentHash, address publisher) internal pure returns (bytes32) {
        return keccak256(abi.encode(contentHash, publisher));
    }
}
