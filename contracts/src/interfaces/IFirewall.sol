// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TrustTier} from "./Types.sol";

/// Read-only safety check other contracts can call. Fixed cost, no loops.
///
/// A contract cannot read another contract's storage, so `verifyContract` detects a change of the
/// target's own bytecode but not a proxy swapping its implementation. A target marked as a proxy
/// never gets a SAFE tier from this interface. Callers that must trust a proxy need the SDK, which
/// reads the implementation slot over RPC.
interface IFirewall {
    function verifyContract(address target)
        external
        view
        returns (
            TrustTier tier,
            bool isUpgradeableProxy,
            bytes32 pinnedCodehash,
            uint32 activeFlags,
            uint256 warrantyBondActive
        );

    function verifySkillBundle(bytes32 canonicalBundleHash)
        external
        view
        returns (TrustTier tier, address publisher, uint32 activeFlags, uint256 warrantyBondActive);
}
