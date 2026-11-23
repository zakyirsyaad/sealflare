// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// A small contract with real runtime code, deployed as an attestation target in tests.
contract TinyTarget {
    function ping() external pure returns (uint256) {
        return 1;
    }
}
