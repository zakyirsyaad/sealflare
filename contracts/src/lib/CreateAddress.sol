// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The address a `CREATE` from `deployer` at `nonce` produces: keccak256(rlp([deployer, nonce]))[12:].
library CreateAddress {
    /// Returns address(0) for a nonce above type(uint64).max, which no account can reach (EIP-2681).
    function compute(address deployer, uint256 nonce) internal pure returns (address) {
        if (nonce > type(uint64).max) return address(0);
        bytes memory encoded;
        if (nonce == 0) {
            encoded = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(0x80));
        } else if (nonce <= 0x7f) {
            encoded = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, uint8(nonce));
        } else {
            uint256 len = _byteLength(nonce);
            bytes memory nonceBytes = new bytes(len);
            for (uint256 i = 0; i < len; ++i) {
                nonceBytes[i] = bytes1(uint8(nonce >> (8 * (len - 1 - i))));
            }
            // List payload: 0x94 + 20 address bytes + (0x80 + len) + len nonce bytes = 22 + len.
            encoded = abi.encodePacked(
                bytes1(uint8(0xc0 + 22 + len)), bytes1(0x94), deployer, bytes1(uint8(0x80 + len)), nonceBytes
            );
        }
        return address(uint160(uint256(keccak256(encoded))));
    }

    function _byteLength(uint256 value) private pure returns (uint256 len) {
        while (value != 0) {
            ++len;
            value >>= 8;
        }
    }
}
