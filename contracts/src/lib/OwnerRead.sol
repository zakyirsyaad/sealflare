// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Reads `owner()` from an untrusted target without letting it waste the caller's gas.
library OwnerRead {
    uint256 internal constant OWNER_CALL_GAS = 30_000;

    /// address(0) means no owner: the call failed, returned anything but exactly 32 bytes, set any
    /// of the upper 12 bytes, or returned zero. Return data is only copied after its size is
    /// checked, so a target answering with megabytes cannot charge the caller for the copy.
    function ownerOf(address target) internal view returns (address owner) {
        bytes4 selector = bytes4(keccak256("owner()"));
        bool ok;
        uint256 word;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            ok := staticcall(OWNER_CALL_GAS, target, ptr, 4, 0, 0)
            if and(ok, eq(returndatasize(), 32)) {
                returndatacopy(ptr, 0, 32)
                word := mload(ptr)
            }
        }
        if (!ok || word >> 160 != 0) return address(0);
        return address(uint160(word));
    }
}
