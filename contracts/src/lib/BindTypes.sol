// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// EIP-712 typed data a target's owner or deployer signs to name an Agent ID holder as publisher.
/// Mirrors EIP712 in shared/abi; both are checked against shared/rules/vectors/eip712.json.
///
/// `bindNonce` is Core's per-target counter. Every binding consumes it, so a signature cannot be
/// replayed after the owner has signed for someone else.
library BindTypes {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("Sealflare");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    bytes32 internal constant BIND_BY_OWNER_TYPEHASH =
        keccak256("BindByOwner(address target,address agentIdHolder,uint256 bindNonce,uint256 deadline)");
    bytes32 internal constant BIND_BY_DEPLOYER_TYPEHASH = keccak256(
        "BindByDeployer(address target,address deployer,uint256 deployNonce,address agentIdHolder,uint256 bindNonce,uint256 deadline)"
    );

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract));
    }

    function hashBindByOwner(address target, address agentIdHolder, uint256 bindNonce, uint256 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(BIND_BY_OWNER_TYPEHASH, target, agentIdHolder, bindNonce, deadline));
    }

    function hashBindByDeployer(
        address target,
        address deployer,
        uint256 deployNonce,
        address agentIdHolder,
        uint256 bindNonce,
        uint256 deadline
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(BIND_BY_DEPLOYER_TYPEHASH, target, deployer, deployNonce, agentIdHolder, bindNonce, deadline)
        );
    }
}
